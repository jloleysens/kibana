/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'node:crypto';
import type { ElasticsearchClient, KibanaRequest } from '@kbn/core/server';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import { ExecutionError } from '@kbn/workflows/server';
import type { KiRevision, KiWriter, StoredKi } from '../ai_indices/ki_revision';
import { getKiRevision, putKiRevision, writeKiRevision } from '../ai_indices/ki_revision';
import type { KiStepDependencies, ResolvedAiIndex } from '../step_types/helpers';
import {
  assertContextEngineEnabled,
  assertKiWritePrivilege,
  assertWritableDest,
  resolveAiIndex,
  resolveOrCreateAiIndex,
  withKiWriteTelemetry,
} from '../step_types/helpers';
import type { createVerifyKiOperation } from '../step_types/verify_ki';
import type { KiOperationsApi, KiWriteOutcome, KiWriteStepAction } from './ki_tokens';
import { isAbortError } from '../telemetry/error_utils';
import { createKiTransportError } from './ki_errors';

export interface KiOperationsDependencies extends KiStepDependencies {
  getScopedEsClient(request: KibanaRequest): Promise<ElasticsearchClient>;
  verify: ReturnType<typeof createVerifyKiOperation>;
}
const contentFields = new Set([
  'type',
  'title',
  'description',
  'content',
  'tags',
  'attributes',
  'references',
  'expires_at',
]);
const pickKiContent = (source: StoredKi): StoredKi =>
  Object.fromEntries(Object.entries(source).filter(([key]) => contentFields.has(key)));

interface WriteReference {
  scopeId: string;
  aiIndexId: string;
  action: KiWriteStepAction;
  authorized: boolean;
  controller: AbortController;
  signal: AbortSignal;
  resolved?: ResolvedAiIndex;
  revisions: Map<string, { kiId: string; revision: KiRevision }>;
  setManaged(managed: boolean): void;
  complete(outcome: KiWriteOutcome): void;
  telemetry: Promise<void>;
  cleanup(): void;
}

/** Keeps destination authority, revision snapshots, provenance and telemetry on the scoped coordinator. */
@remotable()
export class KiOperations implements KiOperationsApi {
  readonly #writes = new Map<string, WriteReference>();
  readonly #verifications = new Map<
    string,
    { scopeId: string; controller: AbortController; signal: AbortSignal; cleanup(): void }
  >();
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly dependencies: KiOperationsDependencies
  ) {}

  async assertEnabled(scopeId: string): Promise<void> {
    return this.#call(scopeId, 0, async () =>
      assertContextEngineEnabled(
        this.dependencies.isContextEngineEnabled,
        this.scopes.getRunState(scopeId).spaceId
      )
    );
  }

  async openWrite(scopeId: string, stepId: string, aiIndexId: string): Promise<string> {
    return this.#call(
      scopeId,
      Buffer.byteLength(stepId) + Buffer.byteLength(aiIndexId),
      async () => {
        const type = this.scopes.resolveStepType(scopeId, stepId);
        const action =
          type === 'context-engine.createKi'
            ? 'create'
            : type === 'context-engine.updateKi'
            ? 'update'
            : type === 'context-engine.deleteKi'
            ? 'delete'
            : undefined;
        if (!action) throw new Error('Not a KI write step in this run');
        const controller = new AbortController();
        const scopeSignal = this.scopes.getAbortSignal(scopeId);
        const onScopeAbort = () => controller.abort();
        scopeSignal.addEventListener('abort', onScopeAbort, { once: true });
        const signal = controller.signal;
        const reference = randomUUID();
        let complete: WriteReference['complete'] = () => {
          throw new Error('KI completion not initialized');
        };
        let setManaged: WriteReference['setManaged'] = () => {
          throw new Error('KI telemetry not initialized');
        };
        const pending = new Promise<KiWriteOutcome>((resolve) => {
          complete = resolve;
        });
        const telemetry = withKiWriteTelemetry({
          action,
          aiIndexId,
          analyticsService: this.dependencies.analyticsService,
          logger: this.dependencies.logger,
          run: async (set) => {
            setManaged = set;
            const outcome = await pending;
            if ('error' in outcome) {
              if (outcome.error.aborted) {
                const error = new Error(outcome.error.message);
                error.name = 'AbortError';
                throw error;
              }
              throw new ExecutionError({
                type: outcome.error.type,
                message: outcome.error.message,
              });
            }
            return { output: outcome };
          },
        }).then(() => {});
        void telemetry.catch(() => {});
        const onAbort = () => {
          this.#writes.delete(reference);
          scopeSignal.removeEventListener('abort', onScopeAbort);
          complete({
            error: { message: 'KI run scope closed', type: 'AbortError', aborted: true },
          });
        };
        signal.addEventListener('abort', onAbort, { once: true });
        this.#writes.set(reference, {
          scopeId,
          aiIndexId,
          action,
          authorized: false,
          controller,
          signal,
          revisions: new Map(),
          setManaged,
          complete,
          telemetry,
          cleanup: () => {
            signal.removeEventListener('abort', onAbort);
            scopeSignal.removeEventListener('abort', onScopeAbort);
          },
        });
        return reference;
      }
    );
  }

  async cancelWrite(scopeId: string, reference: string): Promise<void> {
    return this.#call(scopeId, Buffer.byteLength(reference), async () => {
      const write = this.#writes.get(reference);
      if (!write) return;
      if (write.scopeId !== scopeId) throw new Error('Foreign KI write reference');
      write.controller.abort();
    });
  }

  async openVerification(scopeId: string): Promise<string> {
    return this.#call(scopeId, 0, async () => {
      const reference = randomUUID();
      const controller = new AbortController();
      const signal = controller.signal;
      const scopeSignal = this.scopes.getAbortSignal(scopeId);
      const onAbort = () => {
        this.#verifications.delete(reference);
        controller.abort();
      };
      scopeSignal.addEventListener('abort', onAbort, { once: true });
      this.#verifications.set(reference, {
        scopeId,
        controller,
        signal,
        cleanup: () => scopeSignal.removeEventListener('abort', onAbort),
      });
      return reference;
    });
  }

  async cancelVerification(scopeId: string, reference: string): Promise<void> {
    return this.#call(scopeId, Buffer.byteLength(reference), async () => {
      const verification = this.#verifications.get(reference);
      if (!verification) return;
      if (verification.scopeId !== scopeId) throw new Error('Foreign KI verification reference');
      verification.controller.abort();
    });
  }

  async authorizeWrite(scopeId: string, reference: string): Promise<void> {
    return this.#call(scopeId, Buffer.byteLength(reference), async () => {
      const write = this.#reference(scopeId, reference);
      await assertKiWritePrivilege(
        this.dependencies.checkWritePrivilege,
        this.scopes.get<KibanaRequest>(scopeId),
        this.scopes.getRunState(scopeId).spaceId
      );
      this.#reference(scopeId, reference).authorized = true;
      write.authorized = true;
    });
  }

  async resolve(scopeId: string, reference: string): ReturnType<KiOperationsApi['resolve']> {
    return this.#call(scopeId, Buffer.byteLength(reference), async () => {
      const write = this.#reference(scopeId, reference, true);
      const resolved = await (write.action === 'create' ? resolveOrCreateAiIndex : resolveAiIndex)(
        this.dependencies.getAiIndexService,
        write.aiIndexId,
        this.scopes.getRunState(scopeId).spaceId
      );
      this.#reference(scopeId, reference, true);
      write.resolved = structuredClone(resolved);
      write.setManaged(resolved.managed);
      return structuredClone(resolved);
    });
  }

  async readRevision(
    scopeId: string,
    reference: string,
    kiId: string,
    includeSource: boolean
  ): ReturnType<KiOperationsApi['readRevision']> {
    return this.#call(scopeId, Buffer.byteLength(reference) + Buffer.byteLength(kiId), async () => {
      const write = this.#reference(scopeId, reference, true);
      if (!write.resolved) throw new Error('KI destination not resolved');
      const esClient = await this.dependencies.getScopedEsClient(
        this.scopes.get<KibanaRequest>(scopeId)
      );
      this.#reference(scopeId, reference, true);
      const revision = await getKiRevision({
        esClient,
        aiIndexId: write.aiIndexId,
        dest: write.resolved.dest,
        kiId,
        includeSource,
        abortSignal: write.signal,
      });
      this.#reference(scopeId, reference, true);
      const revisionReference = randomUUID();
      write.revisions.set(revisionReference, { kiId, revision });
      // Do not share an in-process mutable object with the coordinator snapshot.
      return { reference: revisionReference, revision: structuredClone(revision) };
    });
  }

  async writeRevision(
    ...[scopeId, reference, revisionReference, changes, refresh]: Parameters<
      KiOperationsApi['writeRevision']
    >
  ): ReturnType<KiOperationsApi['writeRevision']> {
    return this.#call(scopeId, Buffer.byteLength(JSON.stringify(changes)), async () => {
      const write = this.#reference(scopeId, reference, true);
      const stored = write.revisions.get(revisionReference);
      if (!stored || !write.resolved || write.action === 'create')
        throw new Error('Unknown KI revision reference');
      write.revisions.delete(revisionReference);
      const esClient = await this.dependencies.getScopedEsClient(
        this.scopes.get<KibanaRequest>(scopeId)
      );
      this.#reference(scopeId, reference, true);
      const { governance, ...fields } = changes;
      return writeKiRevision({
        esClient,
        aiIndexId: write.aiIndexId,
        dest: write.resolved.dest,
        ...stored,
        changes: {
          ...pickKiContent(fields),
          updated_at: changes.updated_at,
          governance: {
            ...(governance.lifecycle && { lifecycle: { status: governance.lifecycle.status } }),
            provenance: { updated_by: this.#writer(scopeId) },
          },
        },
        refresh,
        abortSignal: write.signal,
      });
    });
  }

  async putRevision(
    ...[scopeId, reference, kiId, document, refresh]: Parameters<KiOperationsApi['putRevision']>
  ): Promise<void> {
    return this.#call(scopeId, Buffer.byteLength(JSON.stringify(document)), async () => {
      const write = this.#reference(scopeId, reference, true);
      if (!write.resolved || write.action !== 'create') throw new Error('Not a resolved KI create');
      assertWritableDest(write.aiIndexId, write.resolved.dest);
      const esClient = await this.dependencies.getScopedEsClient(
        this.scopes.get<KibanaRequest>(scopeId)
      );
      this.#reference(scopeId, reference, true);
      const writer = this.#writer(scopeId);
      const { governance, ...fields } = document;
      await putKiRevision({
        esClient,
        aiIndexId: write.aiIndexId,
        dest: write.resolved.dest,
        kiId,
        document: {
          ...pickKiContent(fields),
          '@timestamp': document['@timestamp'],
          id: kiId,
          updated_at: document.updated_at,
          governance: {
            ...(governance?.lifecycle && { lifecycle: { status: governance.lifecycle.status } }),
            provenance: { created_by: writer, updated_by: writer },
          },
        },
        refresh,
        abortSignal: write.signal,
      });
    });
  }

  async finishWrite(scopeId: string, reference: string, outcome: KiWriteOutcome): Promise<void> {
    return this.#call(scopeId, Buffer.byteLength(JSON.stringify(outcome)), async () => {
      const write = this.#reference(scopeId, reference);
      this.#writes.delete(reference);
      write.cleanup();
      write.complete(outcome);
      try {
        await write.telemetry;
      } catch (error) {
        if (!('error' in outcome)) throw error;
      }
    });
  }

  async verify(
    scopeId: string,
    reference: string,
    params: Parameters<KiOperationsApi['verify']>[2]
  ): ReturnType<KiOperationsApi['verify']> {
    return this.#call(scopeId, Buffer.byteLength(JSON.stringify(params)), async () => {
      const verification = this.#verifications.get(reference);
      if (!verification || verification.scopeId !== scopeId)
        throw new Error('Unknown KI verification reference');
      const request = this.scopes.get<KibanaRequest>(scopeId);
      const state = this.scopes.getRunState(scopeId);
      const { workflowVersion, metadata, parent } = this.scopes.getRunDefinitionFacts(scopeId);
      try {
        return await this.dependencies.verify({
          ki: params.ki,
          verifiers: params.verifiers,
          aiIndexId: params.aiIndexId,
          totalTimeoutSec: params.totalTimeoutSec,
          request,
          workflow: {
            id: state.workflowId,
            name: state.workflowName,
            enabled: true,
            spaceId: state.spaceId,
            version: workflowVersion,
          },
          metadata,
          parent,
          getEsClient: async () => {
            const client = await this.dependencies.getScopedEsClient(request);
            verification.signal.throwIfAborted();
            return client;
          },
          abortSignal: verification.signal,
        });
      } finally {
        this.#verifications.delete(reference);
        verification.cleanup();
      }
    });
  }

  #writer(scopeId: string): KiWriter {
    const { workflowId, workflowRunId, spaceId } = this.scopes.getRunState(scopeId);
    const { workflowVersion } = this.scopes.getRunDefinitionFacts(scopeId);
    return {
      uri: 'workflow://' + workflowId,
      metadata: {
        ...(workflowVersion !== undefined && { version: workflowVersion }),
        run_id: workflowRunId,
        space_id: spaceId,
      },
    };
  }

  #reference(scopeId: string, reference: string, authorized = false): WriteReference {
    this.scopes.getAbortSignal(scopeId).throwIfAborted();
    const write = this.#writes.get(reference);
    if (!write || write.scopeId !== scopeId) throw new Error('Unknown KI write reference');
    if (authorized && !write.authorized) throw new Error('KI write not authorized');
    return write;
  }

  async #call<T>(scopeId: string, payloadBytes: number, operation: () => Promise<T>): Promise<T> {
    const started = performance.now();
    const cpu = process.cpuUsage();
    try {
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      this.scopes.getRunState(scopeId);
      const result = await operation();
      signal.throwIfAborted();
      return result;
    } catch (error) {
      throw Object.assign(createKiTransportError(error instanceof Error ? error : String(error)), {
        workflowKiAborted: isAbortError(error),
      });
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('context_engine_ki_operations', {
        scopeId,
        payloadBytes,
        durationMs: performance.now() - started,
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, KibanaRequest } from '@kbn/core/server';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import { assertContextEngineEnabled } from '../step_types/step_guards';
import type { FeedbackAnalysisStepDependencies } from '../step_types/helpers';
import { assertRecordImprovementsWritePrivilege } from '../step_types/record_improvements_handler';
import { recordImprovementsForIndex } from '../step_types/record_improvements_operation';
import type { RecordImprovementsOperationsApi } from './record_improvements_tokens';
import { createKiTransportError } from './ki_errors';

export interface RecordImprovementsOperationsDependencies extends FeedbackAnalysisStepDependencies {
  getScopedEsClient(request: KibanaRequest): Promise<ElasticsearchClient>;
}

/** Retains original oversized proposal validation/store/audit with the run's own request and space. */
@remotable()
export class RecordImprovementsOperations implements RecordImprovementsOperationsApi {
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly dependencies: RecordImprovementsOperationsDependencies
  ) {}
  async assertEnabled(scopeId: string): Promise<void> {
    return this.#call(scopeId, 0, () =>
      assertContextEngineEnabled(
        this.dependencies.isContextEngineEnabled,
        this.scopes.getRunState(scopeId).spaceId
      )
    );
  }
  async checkWritePrivilege(scopeId: string): Promise<boolean> {
    return this.#call(scopeId, 0, async () =>
      this.dependencies.checkWritePrivilege(
        this.scopes.get<KibanaRequest>(scopeId),
        this.scopes.getRunState(scopeId).spaceId
      )
    );
  }
  async record(
    scopeId: string,
    params: Parameters<RecordImprovementsOperationsApi['record']>[1]
  ): ReturnType<RecordImprovementsOperationsApi['record']> {
    return this.#call(scopeId, Buffer.byteLength(JSON.stringify(params)), async () => {
      const request = this.scopes.get<KibanaRequest>(scopeId);
      const { spaceId } = this.scopes.getRunState(scopeId);
      await assertRecordImprovementsWritePrivilege(() =>
        this.dependencies.checkWritePrivilege(request, spaceId)
      );
      this.scopes.getAbortSignal(scopeId).throwIfAborted();
      const esClient = await this.dependencies.getScopedEsClient(request);
      this.scopes.getAbortSignal(scopeId).throwIfAborted();
      return recordImprovementsForIndex(
        {
          aiIndexId: params.aiIndexId,
          // Original step input is user-authored evidence, not authoritative workflow provenance.
          agentRunId: params.agentRunId,
          signalWindow: params.signalWindow,
          signalSpaces: params.signalSpaces,
          proposals: params.proposals,
        },
        { ...this.dependencies, request, spaceId, esClient }
      );
    });
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
      throw createKiTransportError(error instanceof Error ? error : String(error));
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('context_engine_record_operations', {
        scopeId,
        payloadBytes,
        durationMs: performance.now() - started,
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }
}

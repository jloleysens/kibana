/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'node:crypto';
import type { ElasticsearchClient, KibanaRequest, Logger } from '@kbn/core/server';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { remotable, recordRemoteTiming } from '@kbn/core-remote-common';
import { classifyDetections } from '../step_definitions/classify_detections';
import { resolveModelForStep } from '../step_definitions/resolve_model';
import type { ResolveModelDependencies } from '../step_definitions/resolve_model';
import type { SignificantEventsOperationsApi } from './tokens';
import { createSignificantEventsTransportError } from './errors';

export interface SignificantEventsOperationsDependencies extends ResolveModelDependencies {
  getScopedEsClient(request: KibanaRequest): Promise<ElasticsearchClient>;
  classificationLogger: Logger;
}
interface ClassificationReference {
  scopeId: string;
  controller: AbortController;
  release(): void;
  started: boolean;
}

/** Keeps original live request policy and oversized read-only ESQL classifier on the coordinator. */
@remotable()
export class SignificantEventsOperations implements SignificantEventsOperationsApi {
  readonly #classifications = new Map<string, ClassificationReference>();
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly dependencies: SignificantEventsOperationsDependencies
  ) {}

  async resolveModel(
    scopeId: string,
    input: Parameters<SignificantEventsOperationsApi['resolveModel']>[1]
  ): Promise<string> {
    return this.#call(scopeId, 'resolveModel', input, () =>
      resolveModelForStep(
        { step: input.step, connector_id: input.connector_id },
        () => this.scopes.get<KibanaRequest>(scopeId),
        this.dependencies
      )
    );
  }
  async openClassification(scopeId: string, stepId: string): Promise<string> {
    return this.#call(scopeId, 'openClassification', stepId, async () => {
      if (this.scopes.resolveStepType(scopeId, stepId) !== 'significantEvents.classifyDetections')
        throw new Error('Not a significant events classification step');
      const reference = randomUUID();
      const controller = new AbortController();
      const signal = this.scopes.getAbortSignal(scopeId);
      const abort = () => {
        controller.abort(signal.reason);
        this.#classifications.delete(reference);
        signal.removeEventListener('abort', abort);
      };
      signal.addEventListener('abort', abort, { once: true });
      this.#classifications.set(reference, {
        scopeId,
        controller,
        started: false,
        release: () => signal.removeEventListener('abort', abort),
      });
      return reference;
    });
  }
  async classify(
    scopeId: string,
    reference: string,
    input: Parameters<SignificantEventsOperationsApi['classify']>[2]
  ): ReturnType<SignificantEventsOperationsApi['classify']> {
    return this.#call(scopeId, 'classify', input, async () => {
      const state = this.#getClassification(scopeId, reference);
      if (state.started) throw new Error('Classification reference already consumed');
      state.started = true;
      try {
        return await classifyDetections({
          input: {
            rows: input.rows,
            columns: input.columns,
            space_id: input.space_id,
            probe_window_minutes: input.probe_window_minutes,
            probe_timeout_ms: input.probe_timeout_ms,
            probe_concurrency: input.probe_concurrency,
            budget_ms: input.budget_ms,
            max_skip_age_hours: input.max_skip_age_hours,
            review_fresh_minutes: input.review_fresh_minutes,
            baseline_bucket_minutes: input.baseline_bucket_minutes,
            baseline_window_minutes: input.baseline_window_minutes,
          },
          getEsClient: async () => {
            const client = await this.dependencies.getScopedEsClient(
              this.scopes.get<KibanaRequest>(scopeId)
            );
            state.controller.signal.throwIfAborted();
            return client;
          },
          abortSignal: state.controller.signal,
          logger: this.dependencies.classificationLogger,
        });
      } finally {
        state.release();
        this.#classifications.delete(reference);
      }
    });
  }
  async closeClassification(scopeId: string, reference: string): Promise<void> {
    return this.#call(scopeId, 'closeClassification', reference, async () => {
      const state = this.#classifications.get(reference);
      if (!state) return;
      if (state.scopeId !== scopeId) throw new Error('Unknown classification reference');
      state.controller.abort();
      state.release();
      this.#classifications.delete(reference);
    });
  }
  #getClassification(scopeId: string, reference: string): ClassificationReference {
    const state = this.#classifications.get(reference);
    if (!state || state.scopeId !== scopeId) throw new Error('Unknown classification reference');
    return state;
  }
  async #call<T>(
    scopeId: string,
    operation: string,
    input: object | string,
    call: () => Promise<T>
  ): Promise<T> {
    const started = performance.now();
    const cpu = process.cpuUsage();
    try {
      this.scopes.getRunState(scopeId);
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      const result = await call();
      signal.throwIfAborted();
      return result;
    } catch (error) {
      throw createSignificantEventsTransportError(error instanceof Error ? error : String(error));
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('significant_events_operations_' + operation, {
        scopeId,
        payloadBytes: Buffer.byteLength(JSON.stringify(input)),
        durationMs: performance.now() - started,
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, KibanaRequest } from '@kbn/core/server';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import { buildFeedbackContext } from '../feedback_analysis/context';
import { InvalidSignalWindowError } from '../feedback_analysis/errors';
import type { ImprovementsServiceApi } from '../improvements/service';
import type { AiIndexService } from '../ai_indices/service';
import { AiIndexNotFoundError } from '../ai_indices/errors';
import type { FeedbackOperationsApi } from './feedback_tokens';
import { createRegistryTransportError } from './registry_errors';

export interface FeedbackOperationsDependencies {
  getAiIndexService: () => AiIndexService;
  getImprovementsService: (
    esClient: ElasticsearchClient,
    spaceId: string
  ) => ImprovementsServiceApi;
  getScopedEsClient: (request: KibanaRequest) => Promise<ElasticsearchClient>;
  isContextEngineEnabled: (spaceId: string) => Promise<boolean>;
  isFeedbackLoopEnabled: () => Promise<boolean>;
}

/** Retains the original oversized feedback service with scoped clients, never whole step contexts. */
@remotable()
export class FeedbackOperations implements FeedbackOperationsApi {
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly dependencies: FeedbackOperationsDependencies
  ) {}

  async isContextEngineEnabled(scopeId: string): Promise<boolean> {
    return this.#read(scopeId, 0, (spaceId) => this.dependencies.isContextEngineEnabled(spaceId));
  }

  async isFeedbackLoopEnabled(scopeId: string): Promise<boolean> {
    return this.#read(scopeId, 0, () => this.dependencies.isFeedbackLoopEnabled());
  }

  async buildContext(
    scopeId: string,
    aiIndexId: string
  ): ReturnType<FeedbackOperationsApi['buildContext']> {
    return this.#read(scopeId, Buffer.byteLength(aiIndexId), async (spaceId) => {
      try {
        const request = this.scopes.get<KibanaRequest>(scopeId);
        const esClient = await this.dependencies.getScopedEsClient(request);
        this.scopes.getAbortSignal(scopeId).throwIfAborted();
        const context = await buildFeedbackContext(aiIndexId, spaceId, {
          esClient,
          aiIndexService: this.dependencies.getAiIndexService(),
          improvementsService: this.dependencies.getImprovementsService(esClient, spaceId),
        });
        return { outcome: 'success', context } as const;
      } catch (error) {
        if (error instanceof AiIndexNotFoundError) return { outcome: 'not-found' } as const;
        if (error instanceof InvalidSignalWindowError)
          return { outcome: 'invalid-window', message: error.message } as const;
        throw error;
      }
    });
  }

  async #read<T>(
    scopeId: string,
    payloadBytes: number,
    read: (spaceId: string) => Promise<T>
  ): Promise<T> {
    const started = performance.now();
    const cpu = process.cpuUsage();
    try {
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      const { spaceId } = this.scopes.getRunState(scopeId);
      const result = await read(spaceId);
      signal.throwIfAborted();
      return result;
    } catch (error) {
      throw createRegistryTransportError(error instanceof Error ? error : String(error));
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('context_engine_feedback_operations', {
        scopeId,
        durationMs: performance.now() - started,
        payloadBytes,
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }
}

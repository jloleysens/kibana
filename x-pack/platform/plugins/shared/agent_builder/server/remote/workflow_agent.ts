/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'node:crypto';
import pick from 'lodash/pick';
import type { KibanaRequest } from '@kbn/core/server';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import { ResponseSizeLimitError, safeOutputSize } from '@kbn/workflows-execution-engine/server';
import type { WorkflowAgentApi, WorkflowAgentResult } from './workflow_agent_tokens';
import type {
  RunAgentOperation,
  WorkflowAgentParams,
  WorkflowAgentOutcome,
} from './run_agent_types';
import { createRegistryTransportError } from './registry_errors';

interface PendingResult {
  readonly controller: AbortController;
  readonly result: Promise<WorkflowAgentResult>;
  taken: boolean;
}
interface ScopeResults {
  readonly signal: AbortSignal;
  readonly results: Map<string, PendingResult>;
}

/** Heavy original agent runtime stays coordinator-local; only scoped typed data crosses the seam. */
@remotable()
export class WorkflowAgent implements WorkflowAgentApi {
  readonly #scopes = new Map<string, ScopeResults>();

  constructor(private readonly scopes: ScopeLookup, private readonly run: RunAgentOperation) {}

  async runAgent(scopeId: string, stepId: string, params: WorkflowAgentParams): Promise<string> {
    try {
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      const state = this.scopes.getRunState(scopeId);
      const request = this.scopes.get<KibanaRequest>(scopeId);
      if (this.scopes.resolveStepType(scopeId, stepId) !== 'ai.agent')
        throw new Error('Step is not an ai.agent in the scoped workflow definition');
      const limit = this.scopes.resolveStepOutputLimit(scopeId, stepId);
      const requestBytes = safeOutputSize(params);
      const scope = this.#scope(scopeId, signal);
      const resultId = randomUUID();
      const controller = new AbortController();
      const started = performance.now();
      const cpu = process.cpuUsage();
      const result = Promise.resolve().then(async (): Promise<WorkflowAgentResult> => {
        const empty = {
          usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0 },
        };
        try {
          if (limit > 0 && (requestBytes === null || requestBytes > limit))
            return {
              outcome: empty,
              sizeError: new ResponseSizeLimitError(limit, stepId, {
                ...(requestBytes !== null ? { actualBytes: requestBytes } : {}),
              }).toSerializableObject(),
            };
          controller.signal.throwIfAborted();
          const outcome = await this.run(
            {
              ...pick(params, [
                'schema',
                'message',
                'conversationId',
                'authorName',
                'attachments',
                'metadata',
                'configurationOverrides',
                'approvals',
                'templateId',
                'templateVersion',
                'templateVariables',
                'agentId',
                'connectorId',
                'featureIds',
                'createConversation',
                'publicConversation',
                'ephemeral',
                'pluginId',
                'aggregateBy',
                'productSolution',
                'productFeature',
                'reasoningLevel',
              ]),
              maxStepSize: limit > 0 ? String(limit) : undefined,
            },
            {
              request,
              abortSignal: controller.signal,
              workflowExecutionId: state.workflowRunId,
              stepId,
            }
          );
          controller.signal.throwIfAborted();
          return this.#boundedResult(scopeId, stepId, limit, outcome);
        } catch (error) {
          return this.#boundedResult(scopeId, stepId, limit, {
            ...empty,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        } finally {
          const elapsed = process.cpuUsage(cpu);
          recordRemoteTiming('agent_builder_run_agent', {
            scopeId,
            durationMs: performance.now() - started,
            payloadBytes: requestBytes ?? 0,
            cpuMicros: elapsed.user + elapsed.system,
          });
        }
      });
      scope.results.set(resultId, { controller, result, taken: false });
      return resultId;
    } catch (error) {
      throw createRegistryTransportError(error);
    }
  }

  async takeResult(scopeId: string, resultId: string): Promise<WorkflowAgentResult> {
    try {
      const { scope, pending } = this.#owned(scopeId, resultId);
      if (pending.taken) throw new Error('Agent result has already been consumed');
      pending.taken = true;
      try {
        const result = await pending.result;
        scope.signal.throwIfAborted();
        return result;
      } finally {
        scope.results.delete(resultId);
      }
    } catch (error) {
      throw createRegistryTransportError(error);
    }
  }

  async cancel(scopeId: string, resultId: string): Promise<void> {
    try {
      const { pending } = this.#owned(scopeId, resultId);
      pending.controller.abort(new Error('Workflow agent step aborted'));
    } catch (error) {
      throw createRegistryTransportError(error);
    }
  }

  #boundedResult(
    scopeId: string,
    stepId: string,
    limit: number,
    outcome: WorkflowAgentOutcome
  ): WorkflowAgentResult {
    const output = {
      message: outcome.result?.message ?? '',
      structured_output: outcome.result?.structuredOutput,
      ...(outcome.result?.conversationId && {
        conversation_id: outcome.result.conversationId,
      }),
      metadata: { usage: outcome.usage },
    };
    const transported = {
      outcome: {
        ...outcome,
        ...(outcome.error ? { error: createRegistryTransportError(outcome.error) } : {}),
      },
    };
    const outputBytes = safeOutputSize(output);
    const transportBytes = safeOutputSize(transported);
    recordRemoteTiming('agent_builder_run_agent_result', {
      scopeId,
      payloadBytes: transportBytes ?? 0,
    });
    if (
      limit > 0 &&
      (outputBytes === null ||
        transportBytes === null ||
        outputBytes > limit ||
        transportBytes > limit)
    )
      return {
        outcome: { usage: outcome.usage },
        sizeError: new ResponseSizeLimitError(limit, stepId, {
          ...(outputBytes !== null && transportBytes !== null
            ? { actualBytes: Math.max(outputBytes, transportBytes) }
            : {}),
        }).toSerializableObject(),
      };
    return transported;
  }

  #owned(scopeId: string, resultId: string): { scope: ScopeResults; pending: PendingResult } {
    this.scopes.getAbortSignal(scopeId).throwIfAborted();
    this.scopes.getRunState(scopeId);
    const scope = this.#scopes.get(scopeId);
    const pending = scope?.results.get(resultId);
    if (!scope || !pending) throw new Error('Agent result is not owned by this run');
    return { scope, pending };
  }

  #scope(scopeId: string, signal: AbortSignal): ScopeResults {
    const existing = this.#scopes.get(scopeId);
    if (existing) return existing;
    const scope: ScopeResults = { signal, results: new Map() };
    this.#scopes.set(scopeId, scope);
    signal.addEventListener(
      'abort',
      () => {
        this.#scopes.delete(scopeId);
        for (const pending of scope.results.values()) pending.controller.abort(signal.reason);
        scope.results.clear();
      },
      { once: true }
    );
    return scope;
  }
}

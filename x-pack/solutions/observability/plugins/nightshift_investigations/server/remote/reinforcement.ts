/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'node:crypto';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import type { KibanaRequest } from '@kbn/core/server';
import { withRemoteLeaseParent, type ScopeLookup } from '@kbn/core-remote-server';
import { recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import { ResponseSizeLimitError, safeOutputSize } from '@kbn/workflows-execution-engine/server';
import { NIGHTSHIFT_DECISION_TREE_REINFORCEMENT_AGENT_ID } from '../../common/agent_ids';
import { DECISION_TREE_LEARNING_TOOL_IDS } from '../tools/decision_tree/learning_tools_ids';
import { createReinforcementTransportError } from './reinforcement_errors';
import type {
  ReinforcementApi,
  ReinforcementInput,
  ReinforcementResult,
} from './reinforcement_tokens';

interface PendingReinforcement {
  controller: AbortController;
  result: Promise<ReinforcementResult>;
  taken: boolean;
}

/** The original heavy agent runtime keeps its request, telemetry provenance and limits on the coordinator. */
@remotable()
export class Reinforcement implements ReinforcementApi {
  readonly #runs = new Map<string, Map<string, PendingReinforcement>>();
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly getAgentBuilder: () => AgentBuilderPluginStart | undefined,
    private readonly isEnabled: () => boolean
  ) {}

  async read(scopeId: string): ReturnType<ReinforcementApi['read']> {
    try {
      this.#assert(scopeId);
      return { enabled: this.isEnabled(), available: Boolean(this.getAgentBuilder()) };
    } catch (error) {
      throw createReinforcementTransportError(error);
    }
  }

  async begin(scopeId: string, stepId: string, input: ReinforcementInput): Promise<string> {
    try {
      this.#assert(scopeId);
      if (this.scopes.resolveStepType(scopeId, stepId) !== 'nightshift.decisionTreeReinforce')
        throw new Error('Step is not a scoped Nightshift reinforcement');
      const agentBuilder = this.getAgentBuilder();
      if (!agentBuilder) throw new Error('Agent Builder is not available');
      const request = this.scopes.get<KibanaRequest>(scopeId);
      const { workflowRunId } = this.scopes.getRunState(scopeId);
      const limit = this.scopes.resolveStepOutputLimit(scopeId, stepId);
      let pending = this.#runs.get(scopeId);
      if (!pending) {
        pending = new Map();
        this.#runs.set(scopeId, pending);
        const scopeRuns = pending;
        this.scopes.getAbortSignal(scopeId).addEventListener(
          'abort',
          () => {
            this.#runs.delete(scopeId);
            for (const run of scopeRuns.values()) run.controller.abort();
            scopeRuns.clear();
          },
          { once: true }
        );
      }
      const controller = new AbortController();
      const reference = randomUUID();
      const started = performance.now();
      const cpu = process.cpuUsage();
      const result = Promise.resolve().then(async (): Promise<ReinforcementResult> => {
        try {
          controller.signal.throwIfAborted();
          const { result: agentResult } = await withRemoteLeaseParent(this.scopes, scopeId, () =>
            agentBuilder.agents.runAgent({
              request,
              agentId: NIGHTSHIFT_DECISION_TREE_REINFORCEMENT_AGENT_ID,
              interactive: { enabled: false },
              defaultConnectorId: input.defaultConnectorId,
              abortSignal: controller.signal,
              telemetryMetadata: {
                pluginId: 'nightshift_investigation_memory',
                aggregateBy: 'nightshift',
                productSolution: 'observability',
                productFeature: 'nightshift',
                interactionId: workflowRunId,
              },
              agentParams: {
                conversation: input.conversation
                  ? {
                      ...input.conversation,
                      // The beforeAgent hook uses this id as a sandbox key; only the coordinator authors it.
                      id: randomUUID(),
                      agent_id: NIGHTSHIFT_DECISION_TREE_REINFORCEMENT_AGENT_ID,
                    }
                  : undefined,
                nextInput: { message: input.message },
                ...(input.includeLearningTools
                  ? {
                      configurationOverrides: {
                        tools: [{ tool_ids: [...DECISION_TREE_LEARNING_TOOL_IDS] }],
                      },
                    }
                  : {}),
              },
            })
          );
          controller.signal.throwIfAborted();
          const message = agentResult.round.response.message;
          const size = safeOutputSize({ message });
          if (limit > 0 && (size === null || size > limit))
            return {
              sizeError: new ResponseSizeLimitError(limit, stepId, {
                ...(size !== null ? { actualBytes: size } : {}),
              }).toSerializableObject(),
            };
          return { message };
        } catch (error) {
          return { error: createReinforcementTransportError(error) };
        } finally {
          const elapsed = process.cpuUsage(cpu);
          recordRemoteTiming('nightshift_reinforcement', {
            scopeId,
            durationMs: performance.now() - started,
            payloadBytes: Buffer.byteLength(JSON.stringify(input)),
            cpuMicros: elapsed.user + elapsed.system,
          });
        }
      });
      pending.set(reference, { controller, result, taken: false });
      return reference;
    } catch (error) {
      throw createReinforcementTransportError(error);
    }
  }

  async take(scopeId: string, reference: string): Promise<ReinforcementResult> {
    try {
      const run = this.#owned(scopeId, reference);
      if (run.taken) throw new Error('Reinforcement result already consumed');
      run.taken = true;
      try {
        const result = await run.result;
        this.#assert(scopeId);
        return result;
      } finally {
        this.#runs.get(scopeId)?.delete(reference);
      }
    } catch (error) {
      throw createReinforcementTransportError(error);
    }
  }

  async cancel(scopeId: string, reference: string): Promise<void> {
    try {
      this.#owned(scopeId, reference).controller.abort(new Error('Reinforcement step aborted'));
    } catch (error) {
      throw createReinforcementTransportError(error);
    }
  }

  #assert(scopeId: string): void {
    this.scopes.getAbortSignal(scopeId).throwIfAborted();
    this.scopes.getRunState(scopeId);
  }
  #owned(scopeId: string, reference: string): PendingReinforcement {
    this.#assert(scopeId);
    const run = this.#runs.get(scopeId)?.get(reference);
    if (!run) throw new Error('Reinforcement result is not owned by this run');
    return run;
  }
}

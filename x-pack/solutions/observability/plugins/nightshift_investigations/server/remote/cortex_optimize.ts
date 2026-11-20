/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler } from '@kbn/workflows-extensions/server';
import type { InvestigationToolCall } from '../decision_trees/accessed_trees';
import { withToolResults } from '../investigation_round/with_tool_results';
import { withTimeout } from '../step_definitions/with_timeout';
import type { inputSchema, outputSchema } from '../step_definitions/cortex_optimize';
import type { runCortexOptimize } from '../cortex/register_cortex';

const OPTIMIZE_TIMEOUT_MS = 120_000;
type RunOptimize = (
  options: Omit<
    Parameters<typeof runCortexOptimize>[0],
    | 'getAgentBuilder'
    | 'getInference'
    | 'getSavedObjects'
    | 'getUiSettings'
    | 'logger'
    | 'analytics'
  >
) => ReturnType<typeof runCortexOptimize>;
export const createCortexOptimizeHandler =
  ({
    runOptimize,
    isEnabled,
  }: {
    runOptimize: RunOptimize;
    isEnabled?: () => boolean;
  }): StepHandler<typeof inputSchema, typeof outputSchema> =>
  async (context) => {
    if (isEnabled && !isEnabled()) {
      context.logger.info('Skipped Cortex optimize (flag off)');
      return { output: { status: 'ok' as const, skipped: true } };
    }

    context.logger.info(`Running Cortex optimize for agent ${context.input.agent_id ?? 'unknown'}`);
    const { workflow, execution } = context.contextManager.getContext();
    await withTimeout(
      (signal) =>
        runOptimize({
          request: context.contextManager.getFakeRequest(),
          agentId: context.input.agent_id,
          userMessage: context.input.prompt,
          assistantMessage: context.input.response,
          toolCalls: withToolResults(
            (context.input.tool_calls ?? []) as InvestigationToolCall[],
            context.input.tool_results ?? []
          ),
          esClient: context.contextManager.getScopedEsClient(),
          spaceId: workflow.spaceId,
          interactionId: execution.id,
          signal,
          conversationId: context.input.conversation_id,
          roundId: context.input.round_id,
          roundIndex: context.input.round_index,
          requestedConnectorId: context.input.connector_id,
          roundConnectorId: context.input.round_connector_id,
        }),
      OPTIMIZE_TIMEOUT_MS,
      `Cortex optimize timed out after ${OPTIMIZE_TIMEOUT_MS}ms`
    );

    return { output: { status: 'ok' as const } };
  };

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
import type { inputSchema, outputSchema } from '../step_definitions/memory_optimize';
import type { runMemoryOptimize } from '../memory/register_memory';
import { usesKnowledge } from '../agents/agent_policy';
import type { NightshiftTelemetryClient } from '../telemetry';

const OPTIMIZE_TIMEOUT_MS = 120_000;
type RunOptimize = (
  options: Omit<
    Parameters<typeof runMemoryOptimize>[0],
    'getAgentBuilder' | 'getInference' | 'getSavedObjects' | 'getUiSettings' | 'logger'
  >
) => ReturnType<typeof runMemoryOptimize>;
export const createMemoryOptimizeHandler =
  ({
    runOptimize,
    isEnabled,
    telemetry,
  }: {
    runOptimize: RunOptimize;
    isEnabled?: () => boolean;
    telemetry: Pick<NightshiftTelemetryClient, 'reportSemanticMemoryOptimized'>;
  }): StepHandler<typeof inputSchema, typeof outputSchema> =>
  async (context) => {
    if (isEnabled && !isEnabled()) {
      context.logger.info('Skipped memory optimize (flag off)');
      return { output: { status: 'ok' as const, skipped: true } };
    }

    // Same policy as materialize: Memory is only for the Nightshift knowledge agents.
    if (!usesKnowledge(context.input.agent_id)) {
      context.logger.info('Skipped memory optimize for missing or unsupported agent');
      return { output: { status: 'ok' as const, skipped: true } };
    }

    const workflowContext = context.contextManager.getContext();
    // Storage tenancy comes from the trusted execution context; no input can select another Space.
    const { spaceId } = workflowContext.workflow;
    const workflowExecutionId = workflowContext.execution.id;
    const sandboxId = context.input.sandbox_id?.trim() ? context.input.sandbox_id : undefined;
    context.logger.info(
      `Running memory optimize for sandbox ${sandboxId ?? 'none'} (agent ${
        context.input.agent_id ?? 'unknown'
      })`
    );
    context.logger.debug(
      `Memory optimize step promptChars=${context.input.prompt.length} responseChars=${context.input.response.length} ` +
        `recalledIds=${context.input.recalled_ids?.length ?? 0}`
    );

    let summary: Awaited<ReturnType<RunOptimize>>;
    try {
      summary = await withTimeout(
        async (signal) =>
          runOptimize({
            request: context.contextManager.getFakeRequest(),
            agentId: context.input.agent_id,
            userMessage: context.input.prompt,
            assistantMessage: context.input.response,
            toolCalls: withToolResults(
              (context.input.tool_calls ?? []) as InvestigationToolCall[],
              context.input.tool_results ?? []
            ),
            conversationId: context.input.conversation_id,
            roundId: context.input.round_id,
            roundIndex: context.input.round_index,
            recalledIds: context.input.recalled_ids ?? [],
            esClient: context.contextManager.getScopedEsClient(),
            spaceId,
            signal,
            requestedConnectorId: context.input.connector_id,
            roundConnectorId: context.input.round_connector_id,
            interactionId: workflowExecutionId,
          }),
        OPTIMIZE_TIMEOUT_MS,
        `Memory optimize timed out after ${OPTIMIZE_TIMEOUT_MS}ms`,
        context.abortSignal
      );
    } catch (error) {
      telemetry.reportSemanticMemoryOptimized({
        agent_id: context.input.agent_id ?? 'unknown',
        ...(context.input.conversation_id
          ? { conversation_id: context.input.conversation_id }
          : {}),
        ...(context.input.round_id ? { round_id: context.input.round_id } : {}),
        workflow_execution_id: workflowExecutionId,
        outcome: 'failure',
      });
      throw error;
    }

    if (summary && summary.writeFailureCount > 0) {
      telemetry.reportSemanticMemoryOptimized({
        agent_id: context.input.agent_id ?? 'unknown',
        ...(context.input.conversation_id
          ? { conversation_id: context.input.conversation_id }
          : {}),
        ...(context.input.round_id ? { round_id: context.input.round_id } : {}),
        workflow_execution_id: workflowExecutionId,
        outcome: 'failure',
        write_failure_count: summary.writeFailureCount,
      });
      throw new Error(
        `Memory optimize failed to persist ${summary.writeFailureCount} required operation(s)`
      );
    }

    if (!summary) {
      telemetry.reportSemanticMemoryOptimized({
        agent_id: context.input.agent_id ?? 'unknown',
        ...(context.input.conversation_id
          ? { conversation_id: context.input.conversation_id }
          : {}),
        ...(context.input.round_id ? { round_id: context.input.round_id } : {}),
        workflow_execution_id: workflowExecutionId,
        outcome: 'failure',
      });
    } else if (summary) {
      telemetry.reportSemanticMemoryOptimized({
        agent_id: context.input.agent_id ?? 'unknown',
        ...(context.input.conversation_id
          ? { conversation_id: context.input.conversation_id }
          : {}),
        ...(context.input.round_id ? { round_id: context.input.round_id } : {}),
        workflow_execution_id: workflowExecutionId,
        outcome: 'success',
        recalled_count: summary.recalledCount,
        loaded_count: summary.loadedCount,
        useful_count: summary.usefulCount,
        harmful_count: summary.harmfulCount,
        extraction_proposed_count: summary.extractionProposedCount,
        standalone_upsert_count: summary.standaloneUpsertCount,
        safety_skip_count: summary.safetySkipCount,
        merge_attempt_count: summary.mergeAttemptCount,
        merge_success_count: summary.mergeSuccessCount,
        harmful_archive_count: summary.harmfulArchiveCount,
        merged_source_archive_count: summary.mergedSourceArchiveCount,
        write_failure_count: summary.writeFailureCount,
      });
    }

    return { output: { status: 'ok' as const } };
  };

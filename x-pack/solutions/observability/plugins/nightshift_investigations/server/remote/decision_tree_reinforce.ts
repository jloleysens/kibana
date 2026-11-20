/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { v4 as uuidv4 } from 'uuid';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import type { StepHandler, StepHandlerContext } from '@kbn/workflows-extensions/server';
import { NIGHTSHIFT_DECISION_TREE_REINFORCEMENT_AGENT_ID } from '../../common/agent_ids';
import type { InvestigationToolCall } from '../decision_trees/accessed_trees';
import {
  buildInvestigationConversation,
  buildInvestigationRound,
} from '../decision_trees/investigation_round';
import type { loadInvestigationRound } from '../investigation_round/round_loader';
import { DECISION_TREE_LEARNING_TOOL_IDS } from '../tools/decision_tree/learning_tools_ids';
import type { inputSchema, outputSchema } from '../step_definitions/decision_tree_reinforce';

export interface ReinforcementServices {
  loadRound: (
    options: Omit<Parameters<typeof loadInvestigationRound>[0], 'agentBuilder'>
  ) => ReturnType<typeof loadInvestigationRound>;
  runAgent: (
    options: Parameters<AgentBuilderPluginStart['agents']['runAgent']>[0]
  ) => Promise<string>;
}
export const createDecisionTreeReinforceHandler =
  ({
    getServices,
    isEnabled,
  }: {
    getServices: (context: StepHandlerContext) => Promise<ReinforcementServices | undefined>;
    isEnabled?: () => boolean;
  }): StepHandler<typeof inputSchema, typeof outputSchema> =>
  async (context) => {
    // The combined optimize workflow installs with Cortex or Memory, so this step is registered
    // even when the tree feature is off.
    if (isEnabled && !isEnabled()) {
      context.logger.info('Skipped decision tree reinforcement (flag off)');
      return { output: { message: '', skipped: true } };
    }

    const agentBuilder = await getServices(context);
    if (!agentBuilder) {
      throw new Error('Agent Builder is not available');
    }

    const {
      prompt,
      response,
      conversation_id: conversationId,
      round_id: roundId,
      round_index: roundIndex,
      message,
      turn_kind: turnKind,
      connector_id: connectorId,
      tool_calls: toolCalls,
      tool_results: toolResults,
    } = context.input;
    const request = context.contextManager.getFakeRequest();
    const loadedRound = await agentBuilder.loadRound({
      request,
      conversationId: conversationId || undefined,
      roundId: roundId || undefined,
      roundIndex,
      fallbackToolCalls: (toolCalls ?? []) as InvestigationToolCall[],
      fallbackToolResults: toolResults ?? [],
      logger: context.logger,
      signal: context.abortSignal,
    });
    const now = new Date().toISOString();
    const round = buildInvestigationRound({
      // Liquid renders an absent input as '', so empty strings count as unset.
      roundId: loadedRound.roundId || roundId || uuidv4(),
      prompt,
      response,
      toolCalls: loadedRound.toolCalls,
      steps: loadedRound.source === 'persisted_round' ? loadedRound.steps : undefined,
      rawSteps: loadedRound.source === 'persisted_round' ? loadedRound.rawSteps : undefined,
      startedAt: loadedRound.startedAt ?? now,
    });
    // A fresh id per run: the beforeAgent hydrate namespaces the sandbox by conversation id.
    const conversation = buildInvestigationConversation({
      conversationId: uuidv4(),
      agentId: NIGHTSHIFT_DECISION_TREE_REINFORCEMENT_AGENT_ID,
      round,
      now,
    });
    // Matches Deductive: an initial investigation only edits files; learnings need a follow-up.
    const configurationOverrides =
      turnKind === 'feedback_reinforcement'
        ? { tools: [{ tool_ids: [...DECISION_TREE_LEARNING_TOOL_IDS] }] }
        : undefined;

    // The workflow step's `timeout` bounds the run: its timeout zone aborts this signal.
    const resultMessage = await agentBuilder.runAgent({
      request,
      agentId: NIGHTSHIFT_DECISION_TREE_REINFORCEMENT_AGENT_ID,
      interactive: { enabled: false },
      defaultConnectorId: connectorId || undefined,
      abortSignal: context.abortSignal,
      telemetryMetadata: {
        pluginId: 'nightshift_investigation_memory',
        aggregateBy: 'nightshift',
        productSolution: 'observability',
        productFeature: 'nightshift',
        interactionId: context.contextManager.getContext().execution.id,
      },
      agentParams: {
        conversation,
        nextInput: { message },
        ...(configurationOverrides ? { configurationOverrides } : {}),
      },
    });

    return { output: { message: resultMessage } };
  };

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { StepHandler } from '@kbn/workflows-extensions/server';
import { usesDecisionTrees } from '../agents/agent_policy';
import type { InvestigationToolCall } from '../decision_trees/accessed_trees';
import { prepareReinforcementTurn } from '../decision_trees/prepare_reinforcement_turn';
import { withToolResults } from '../investigation_round/with_tool_results';

import type { inputSchema, outputSchema } from '../step_definitions/decision_tree_prepare';

export interface DecisionTreePrepareDeps {
  getTelemetryConnectorId: () => string | undefined;
  logger: Pick<Logger, 'debug'>;
  isEnabled?: () => boolean;
}
export const createDecisionTreePrepareHandler =
  ({
    getTelemetryConnectorId,
    logger,
    isEnabled,
  }: DecisionTreePrepareDeps): StepHandler<typeof inputSchema, typeof outputSchema> =>
  async (context) => {
    const {
      response,
      agent_id: agentId,
      tool_calls: toolCalls,
      tool_results: toolResults,
    } = context.input;
    const skippedOutput = {
      output: {
        message: '',
        tree_count: 0,
        turn_kind: 'initial_investigation' as const,
        skipped: true,
      },
    };

    // The combined optimize workflow installs with Cortex or Memory, so this step runs even
    // when the tree feature is off. `skipped` also gates the reinforcement agent steps.
    if (isEnabled && !isEnabled()) {
      context.logger.info('Skipped decision tree prepare (flag off)');
      return skippedOutput;
    }

    // Only the Nightshift investigator's rounds feed the decision trees: this workflow is its
    // post-execution hook, and another agent's round must not rewrite the trees.
    if (!usesDecisionTrees(agentId)) {
      return skippedOutput;
    }

    const telemetryConnectorId = getTelemetryConnectorId();
    const { spaceId } = context.contextManager.getContext().workflow;
    const { message, treeCount, turnKind } = await prepareReinforcementTurn({
      response,
      connectorNames: telemetryConnectorId ? [telemetryConnectorId] : [],
      esClient: context.contextManager.getScopedEsClient(),
      logger,
      spaceId,
      toolCalls: withToolResults((toolCalls ?? []) as InvestigationToolCall[], toolResults ?? []),
    });

    return {
      output: { message, tree_count: treeCount, turn_kind: turnKind, skipped: false },
    };
  };

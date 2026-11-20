/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { lazySchema, z } from '@kbn/zod/v4';
import { StepCategory } from '@kbn/workflows-runtime';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server/step_registry/types';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import { MAX_KEYWORD_LENGTH } from '../../common/limits';
import {
  investigationRoundInputsSchema,
  loadInvestigationRound,
} from '../investigation_round/round_loader';
import { createDecisionTreeReinforceHandler } from '../remote/decision_tree_reinforce';

const MAX_INPUT_CHARS = 100_000;

export const inputSchema = lazySchema(() =>
  z.object({
    ...investigationRoundInputsSchema,
    prompt: z.string().max(MAX_INPUT_CHARS).describe('The user message that started the round.'),
    response: z
      .string()
      .max(MAX_INPUT_CHARS)
      .describe("The investigator's final response for the round."),
    message: z
      .string()
      .max(MAX_INPUT_CHARS)
      .describe('Turn message from nightshift.decisionTreePrepare.'),
    turn_kind: z
      .enum(['initial_investigation', 'feedback_reinforcement'])
      .describe('Turn kind from nightshift.decisionTreePrepare. Picks the tool set.'),
    connector_id: z
      .string()
      .max(MAX_KEYWORD_LENGTH)
      .optional()
      .describe('Inference connector for the reinforcement run.'),
  })
);
export const outputSchema = lazySchema(() =>
  z.object({
    message: z.string().describe("The reinforcement agent's final response."),
    skipped: z.boolean().optional(),
  })
);

export const decisionTreeReinforceStepDefinition = ({
  getAgentBuilder,
  isEnabled,
}: {
  getAgentBuilder: () => AgentBuilderPluginStart | undefined;
  isEnabled?: () => boolean;
}) =>
  createServerStepDefinition({
    id: 'nightshift.decisionTreeReinforce',
    label: 'Run Decision Tree Reinforcement',
    category: StepCategory.Ai,
    description:
      "Runs the reinforcement agent with the investigator's round as conversation history (its " +
      'tool calls and their results as real tool messages), followed by the prepared turn message.',
    inputSchema,
    outputSchema,
    handler: createDecisionTreeReinforceHandler({
      isEnabled,
      getServices: async () => {
        const agentBuilder = getAgentBuilder();
        if (!agentBuilder) return undefined;
        return {
          loadRound: (options) => loadInvestigationRound({ ...options, agentBuilder }),
          runAgent: async (options) =>
            (await agentBuilder.agents.runAgent(options)).result.round.response.message,
        };
      },
    }),
  });

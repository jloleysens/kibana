/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { lazySchema, z } from '@kbn/zod/v4';
import { StepCategory } from '@kbn/workflows';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server/step_registry/types';
import {
  createDecisionTreePrepareHandler,
  type DecisionTreePrepareDeps,
} from '../remote/decision_tree_prepare';
import { toolCallsSchema, toolResultsSchema } from './tool_calls_schema';

const MAX_INPUT_CHARS = 100_000;

export const inputSchema = lazySchema(() =>
  z.object({
    response: z
      .string()
      .max(MAX_INPUT_CHARS)
      .describe("The investigator's final response for the round."),
    agent_id: z
      .string()
      .max(1024)
      .optional()
      .describe('Agent id that produced the round. Rounds from other agents are skipped.'),
    tool_calls: toolCallsSchema.describe(
      'Investigator tool calls from this round. Used to see which decision-tree files were read.'
    ),
    tool_results: toolResultsSchema.describe(
      'Results of the investigator tool calls, keyed by tool_call_id.'
    ),
  })
);
export const outputSchema = lazySchema(() =>
  z.object({
    message: z.string().describe('Message to hand the reinforcement agent.'),
    tree_count: z.number().describe('Number of decision trees the agent may edit.'),
    turn_kind: z
      .enum(['initial_investigation', 'feedback_reinforcement'])
      .describe('Whether this round seeds the trees or follows up on them.'),
    skipped: z.boolean().describe('True when this round is not eligible for reinforcement.'),
  })
);

export const decisionTreePrepareStepDefinition = (deps: DecisionTreePrepareDeps) =>
  createServerStepDefinition({
    id: 'nightshift.decisionTreePrepare',
    label: 'Prepare Decision Tree Reinforcement Turn',
    category: StepCategory.Ai,
    description:
      'Builds the closing reinforcement message for a completed investigation round: the decision ' +
      'trees available to edit, the learnings already on file, and the turn script.',
    inputSchema,
    outputSchema,
    handler: createDecisionTreePrepareHandler(deps),
  });

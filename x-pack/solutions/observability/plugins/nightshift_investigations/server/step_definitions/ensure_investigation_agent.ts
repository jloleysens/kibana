/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { lazySchema, z } from '@kbn/zod/v4';
import { StepCategory } from '@kbn/workflows';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server/step_registry/types';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import type { AgentAvailabilityConfig } from '@kbn/agent-builder-server/agents';
import { createAgentInstaller } from '../remote/agent_installation';
import { createEnsureInvestigationAgentHandler } from '../remote/ensure_investigation_agent';
import { NIGHTSHIFT_INVESTIGATION_AGENT_ID } from '../agents/investigation';
import { NIGHTSHIFT_DECISION_TREE_REINFORCEMENT_AGENT_ID } from '../agents/decision_tree_reinforcement';

export const inputSchema = lazySchema(() =>
  z.object({
    agent_id: z
      .enum([NIGHTSHIFT_INVESTIGATION_AGENT_ID, NIGHTSHIFT_DECISION_TREE_REINFORCEMENT_AGENT_ID])
      .optional()
      .describe(
        `Which investigation agent to install. Defaults to ${NIGHTSHIFT_INVESTIGATION_AGENT_ID}.`
      ),
  })
);
export const outputSchema = lazySchema(() =>
  z.object({
    space_id: z.string().describe('The space the investigation agent was ensured in'),
    agent_id: z.string().describe('The agent that was ensured'),
  })
);

export const ensureInvestigationAgentStepDefinition = (deps: {
  getAgentBuilder: () => AgentBuilderPluginStart | undefined;
  getAgentAvailability: () => AgentAvailabilityConfig;
}) => {
  const install = createAgentInstaller(deps);
  return createServerStepDefinition({
    id: 'nightshift.ensureInvestigationAgent',
    label: 'Ensure Nightshift Investigation Agent',
    category: StepCategory.Ai,
    description:
      'Installs an investigation agent in the space this workflow runs in, so any caller can start an investigation without installing it first. Idempotent: an existing agent is left untouched.',
    inputSchema,
    outputSchema,
    handler: createEnsureInvestigationAgentHandler((context, agentId) =>
      install(context.contextManager.getContext().workflow.spaceId, agentId)
    ),
  });
};

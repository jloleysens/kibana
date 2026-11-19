/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { lazySchema, z } from '@kbn/zod/v4';
import { StepCategory } from '@kbn/workflows';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import type { Logger } from '@kbn/core/server';
import type { SandboxPluginStart } from '@kbn/sandbox-plugin/server';

import { createDecisionTreeHydrateHandler } from '../remote/decision_tree_hydrate';

export const inputSchema = lazySchema(() =>
  z.object({
    sandbox_id: z
      .string()
      .min(1)
      .max(1024)
      .describe('Workspace key from nightshift.obtainSandbox. Already space-scoped.'),
    prompt: z
      .string()
      .max(500_000)
      .optional()
      .describe(
        'The round message. Reinforcement messages carry an accessed-trees marker; without it every tree is written (investigator hydrate).'
      ),
    agent_id: z
      .string()
      .max(1024)
      .optional()
      .describe(
        'Agent the round belongs to. When set, only the investigator gets trees; the ' +
          'reinforcement hydrate workflow omits it.'
      ),
  })
);
export const outputSchema = lazySchema(() =>
  z.object({
    sandbox_id: z.string().describe('Sandbox that was hydrated.'),
    conversation_id: z.string().describe('Unscoped conversation id derived from the sandbox key.'),
    tree_count: z.number().describe('Number of decision trees written into the sandbox.'),
    skipped: z.boolean().optional(),
    failed: z.boolean().optional().describe('The write failed; its contents may be incomplete.'),
    notification: z
      .string()
      .describe(
        'Always empty on success. On failure, the incomplete-materialization notice for ' +
          '/workspace/decision-trees.'
      ),
  })
);

export const decisionTreeHydrateStepDefinition = ({
  getSandboxStart,
  logger,
  isEnabled,
}: {
  getSandboxStart: () => SandboxPluginStart | undefined;
  logger: Logger;
  isEnabled?: () => boolean;
}) =>
  createServerStepDefinition({
    id: 'nightshift.decisionTreeHydrate',
    label: 'Hydrate Decision Trees into Sandbox',
    category: StepCategory.Ai,
    description:
      'Writes the stored decision trees into /workspace/decision-trees for the sandbox obtained ' +
      'earlier in this workflow. Does not allocate; writes to the sandbox_id it is given so every ' +
      'writer addresses the same workspace.',
    inputSchema,
    outputSchema,
    handler: createDecisionTreeHydrateHandler({
      logger,
      isEnabled,
      getSession: async (context, conversationId) => {
        const { spaceId } = context.contextManager.getContext().workflow;
        return getSandboxStart()?.getSessionForSpace(spaceId, conversationId);
      },
    }),
  });

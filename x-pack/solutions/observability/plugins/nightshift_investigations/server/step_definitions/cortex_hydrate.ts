/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { lazySchema, z } from '@kbn/zod/v4';
import { StepCategory } from '@kbn/workflows';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import type { AnalyticsServiceSetup, Logger } from '@kbn/core/server';
import type { SandboxPluginStart } from '@kbn/sandbox-plugin/server';

import { createCortexHydrateHandler } from '../remote/cortex_hydrate';
import { createCortexTelemetry } from '../telemetry/cortex_telemetry';

export const inputSchema = lazySchema(() =>
  z
    .object({
      sandbox_id: z
        .string()
        .min(1)
        .max(1024)
        .optional()
        .describe('Workspace key from nightshift.obtainSandbox. Already space-scoped.'),
      conversation_id: z
        .string()
        .min(1)
        .max(1024)
        .optional()
        .describe('Legacy unscoped conversation id. Scoped using the workflow Space.'),
    })
    .refine(
      ({ sandbox_id: sandboxId, conversation_id: conversationId }) => {
        return sandboxId !== undefined || conversationId !== undefined;
      },
      { message: 'Either sandbox_id or conversation_id is required.' }
    )
);
export const outputSchema = lazySchema(() =>
  z.object({
    sandbox_id: z.string().describe('Sandbox that was hydrated.'),
    conversation_id: z.string().describe('Unscoped conversation id for legacy consumers.'),
    skipped: z.boolean().optional(),
    failed: z.boolean().optional().describe('The write failed; its contents may be incomplete.'),
    notification: z
      .string()
      .describe(
        'Empty on success. On failure, the incomplete-materialization notice for ' +
          '/workspace/cortex.'
      ),
  })
);

export const cortexHydrateStepDefinition = ({
  getSandboxStart,
  analytics,
  logger,
  isEnabled,
}: {
  getSandboxStart: () => SandboxPluginStart | undefined;
  analytics: AnalyticsServiceSetup;
  logger: Logger;
  isEnabled?: () => boolean;
}) =>
  createServerStepDefinition({
    id: 'nightshift.cortexHydrate',
    label: 'Hydrate Nightshift Cortex into Sandbox',
    category: StepCategory.Ai,
    description:
      'Writes the current Cortex wiki into /workspace/cortex for the sandbox obtained ' +
      'earlier in this workflow. Does not allocate; accepts its sandbox_id or a legacy conversation_id.',
    inputSchema,
    outputSchema,
    handler: createCortexHydrateHandler({
      logger,
      isEnabled,
      getWorkspace: async (context, conversationId, telemetryConversationId) => {
        const { spaceId } = context.contextManager.getContext().workflow;
        const session = getSandboxStart()?.getSessionForSpace(spaceId, conversationId);
        if (!session) return undefined;
        return {
          session,
          telemetry: createCortexTelemetry({
            analytics,
            conversationId: telemetryConversationId,
            logger,
          }),
        };
      },
    }),
  });

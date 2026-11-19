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
import type { NightshiftTelemetryClient } from '../telemetry';

import { createMemoryMaterializeHandler } from '../remote/memory_materialize_to_sandbox';

export const inputSchema = lazySchema(() =>
  z.object({
    sandbox_id: z
      .string()
      .min(1)
      .max(1024)
      .describe('Workspace key from nightshift.obtainSandbox. Already space-scoped.'),
    prompt: z
      .string()
      .max(65_536)
      .optional()
      .describe('The user message for this round, used as a memory search query when present.'),
    agent_id: z
      .string()
      .max(1024)
      .optional()
      .describe('Agent whose memory store to materialize. Missing agent_id skips memory.'),
    conversation_id: z
      .string()
      .max(1024)
      .optional()
      .describe('Agent Builder conversation id for telemetry correlation.'),
  })
);
export const outputSchema = lazySchema(() =>
  z.object({
    sandbox_id: z.string().describe('Sandbox that received the memory pages.'),
    skipped: z.boolean().optional(),
    failed: z.boolean().optional().describe('The write failed; its contents may be incomplete.'),
    recalled_ids: z
      .array(z.string())
      .describe('Memory page ids recalled for this exact conversation round.'),
    notification: z
      .string()
      .describe(
        'Markdown fragment listing memory pages new this turn, empty when there were none. ' +
          'On failure, the incomplete-materialization notice for /workspace/memories.'
      ),
  })
);

export const memoryMaterializeToSandboxStepDefinition = ({
  getSandboxStart,
  logger,
  isEnabled,
  telemetry,
}: {
  getSandboxStart: () => SandboxPluginStart | undefined;
  logger: Logger;
  isEnabled?: () => boolean;
  telemetry: NightshiftTelemetryClient;
}) =>
  createServerStepDefinition({
    id: 'nightshift.memoryMaterializeToSandbox',
    label: 'Materialize Nightshift Semantic Memory to Sandbox',
    category: StepCategory.Ai,
    description:
      'Writes ranked Semantic Memory pages into /workspace/memories for the sandbox obtained ' +
      'earlier in this workflow. Does not allocate; uses sandbox_id as-is.',
    inputSchema,
    outputSchema,
    handler: createMemoryMaterializeHandler({
      logger,
      isEnabled,
      getWorkspace: async (context, conversationId) => {
        const { spaceId } = context.contextManager.getContext().workflow;
        const session = getSandboxStart()?.getSessionForSpace(spaceId, conversationId);
        if (!session) return undefined;
        return {
          session,
          getIsReset: () => session.isReset,
          reportMaterialized: (event) => telemetry.reportSemanticMemoryMaterialized(event),
        };
      },
    }),
  });

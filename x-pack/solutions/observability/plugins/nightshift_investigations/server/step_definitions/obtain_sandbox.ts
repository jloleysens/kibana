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
import { createWorkspaceAllocator } from '../remote/allocate_workspace';
import { createObtainSandboxHandler } from '../remote/obtain_sandbox';

export const inputSchema = lazySchema(() =>
  z.object({
    conversation_id: z
      .string()
      .min(1)
      .max(1024)
      .describe('Unscoped conversation id from the Agent Builder hook.'),
    required: z
      .boolean()
      .optional()
      .describe(
        'When false, a missing sandbox config skips allocate and still returns sandbox_id. ' +
          'Hydrate leaves this unset (fail closed). Optimize sets false so transcript ' +
          'extraction still runs.'
      ),
  })
);

export const outputSchema = lazySchema(() =>
  z.object({
    sandbox_id: z
      .string()
      .describe('Workspace key (`<space>__<conversation>`). Pass this to every writer.'),
    conversation_id: z.string().describe('Unscoped conversation id from the hook.'),
    skipped: z.boolean().optional(),
  })
);

/**
 * Forces the sandbox plugin to allocate (or reuse) the conversation's session.
 *
 * Hydrate and optimize writers must not do this themselves: each first RPC on a
 * cold session can restore workspace state. Obtain once, then pass `sandbox_id`.
 *
 * The id is `<space>__<conversation>` — the same key the sandbox plugin uses as
 * the gRPC conversation id. Agent Builder does not thread hydrate output into
 * tools or afterExecution; every stage recomputes this function.
 *
 * Uses getSessionForSpace so Kibana-side connector-manifest init still runs on
 * the first agent tool call.
 */
export const obtainSandboxStepDefinition = ({
  getSandboxStart,
  logger,
}: {
  getSandboxStart: () => SandboxPluginStart | undefined;
  logger: Logger;
}) =>
  createServerStepDefinition({
    id: 'nightshift.obtainSandbox',
    label: 'Obtain Nightshift Sandbox',
    category: StepCategory.Ai,
    description:
      'Allocates the conversation sandbox and returns the space-scoped sandbox_id ' +
      'that hydrate, agent tools, and optimize must share.',
    inputSchema,
    outputSchema,
    handler: createObtainSandboxHandler((context, conversationId, required) => {
      const { spaceId } = context.contextManager.getContext().workflow;
      return createWorkspaceAllocator({ getSandboxStart, logger })(
        spaceId,
        conversationId,
        required
      );
    }),
  });

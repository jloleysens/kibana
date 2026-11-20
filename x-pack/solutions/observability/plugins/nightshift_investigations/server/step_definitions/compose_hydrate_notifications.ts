/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { lazySchema, z } from '@kbn/zod/v4';
import { StepCategory } from '@kbn/workflows';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server/step_registry/types';
import { composeHydrateNotificationsHandler } from '../remote/compose_hydrate_notifications';

export const InputSchema = lazySchema(() =>
  z.object({
    writers: z
      .array(
        z.object({
          directory: z
            .string()
            .max(1024)
            .describe('Absolute sandbox directory this writer materializes into.'),
          notification: z
            .string()
            .optional()
            .describe("The writer's own markdown fragment. Empty when it wrote nothing."),
          completed: z
            .boolean()
            .optional()
            .describe(
              'False when the writer produced no output at all (branch killed by branch-timeout).'
            ),
        })
      )
      .max(16)
      .describe('Every workspace writer of this round, in workflow order.'),
    recalled_ids: z
      .array(z.string())
      .max(100)
      .describe('Semantic Memory ids recalled for this exact round.'),
  })
);

export const OutputSchema = lazySchema(() =>
  z.object({
    model_context: z
      .string()
      .optional()
      .describe('Model-only <system_update> block. Absent when there is nothing to report.'),
    workflow_context: z.object({
      'nightshift.semantic_memory.recall': z.object({
        version: z.literal(1),
        data: z.object({
          recalled_ids: z.array(z.string()).max(100),
        }),
      }),
    }),
  })
);

export const composeHydrateNotificationsStepDefinition = () =>
  createServerStepDefinition({
    id: 'nightshift.composeHydrateNotifications',
    label: 'Compose Nightshift Hydrate Notifications',
    category: StepCategory.Ai,
    description:
      'Builds model-only <system_update> context from the workspace writers. Reports new files, ' +
      'and reports a directory as possibly incomplete when its writer failed or never reported. ' +
      'Does not wrap individual fragments. Omits model_context when there is nothing to report.',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    handler: composeHydrateNotificationsHandler,
  });

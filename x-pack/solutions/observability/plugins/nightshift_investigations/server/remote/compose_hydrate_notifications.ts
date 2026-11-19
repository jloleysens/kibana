/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler } from '@kbn/workflows-extensions/server';
import type { InputSchema, OutputSchema } from '../step_definitions/compose_hydrate_notifications';
import { composeHydrateNotificationContext } from '../lib/hydrate_notification';

export const composeHydrateNotificationsHandler: StepHandler<
  typeof InputSchema,
  typeof OutputSchema
> = async (context) => {
  const { model_context: modelContext } = composeHydrateNotificationContext({
    writers: context.input.writers,
  });
  return {
    output: {
      ...(modelContext ? { model_context: modelContext } : {}),
      workflow_context: {
        'nightshift.semantic_memory.recall': {
          version: 1 as const,
          data: {
            recalled_ids: context.input.recalled_ids,
          },
        },
      },
    },
  };
};

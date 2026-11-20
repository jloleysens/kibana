/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { lazySchema, z } from '@kbn/zod/v4';
import { StepCategory } from '@kbn/workflows';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { inputSchema } from '../remote/handle_investigation_failure_schema';
import { createHandleInvestigationFailureHandler } from '../remote/handle_investigation_failure';
import { emitInvestigationFailure } from '../lib/notifications/emit_investigation_failure';
import type { GetTriggerEmitter } from '../types';
import { sendInvestigationNotifications } from '../lib/notifications/send_investigation_notifications';
import type { InvestigationNotificationDeps } from '../lib/notifications/send_investigation_notifications';

export const outputSchema = lazySchema(() =>
  z.object({
    sent: z.number(),
    failed: z.number(),
    unconfirmed: z.number(),
  })
);

export const handleInvestigationFailureStepDefinition = (
  deps: InvestigationNotificationDeps & { getTriggerEmitter: GetTriggerEmitter }
) =>
  createServerStepDefinition({
    id: 'nightshift.handleInvestigationFailure',
    label: 'Handle Nightshift Investigation Failure',
    category: StepCategory.Ai,
    description:
      'Records an investigation run and reports its failure through lifecycle notifications.',
    inputSchema,
    outputSchema,
    handler: createHandleInvestigationFailureHandler({
      send: (context, options) => sendInvestigationNotifications(deps, context, options),
      ensureForFailure: async (context, investigationId) => {
        await deps
          .getInvestigationsClient(
            context.contextManager.getFakeRequest(),
            context.contextManager.getContext().workflow.spaceId
          )
          .ensureForFailure(investigationId, context.contextManager.getContext().execution.id);
      },
      emitFailure: async (context, investigationId) => {
        const request = context.contextManager.getFakeRequest();
        const client = deps.getInvestigationsClient(
          request,
          context.contextManager.getContext().workflow.spaceId
        );
        await emitInvestigationFailure({
          request,
          client,
          getTriggerEmitter: deps.getTriggerEmitter,
          investigationId,
        });
      },
    }),
  });

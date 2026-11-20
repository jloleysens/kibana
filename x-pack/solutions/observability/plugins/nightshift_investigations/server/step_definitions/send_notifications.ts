/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { lazySchema, z } from '@kbn/zod/v4';
import { StepCategory } from '@kbn/workflows';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { inputSchema } from '../remote/send_notifications_schema';
import { createSendNotificationsHandler } from '../remote/send_notifications';
import { sendInvestigationNotifications } from '../lib/notifications/send_investigation_notifications';
import type { InvestigationNotificationDeps } from '../lib/notifications/send_investigation_notifications';

export const outputSchema = lazySchema(() =>
  z.object({
    sent: z.number().describe('Destinations that received the message in this run'),
    failed: z.number().describe('Destinations whose delivery failed in this run'),
    unconfirmed: z.number().describe('Attempts without a confirmed delivery result'),
  })
);

export const sendNotificationsStepDefinition = (deps: InvestigationNotificationDeps) =>
  createServerStepDefinition({
    id: 'nightshift.sendNotifications',
    label: 'Send Nightshift Notifications',
    category: StepCategory.Ai,
    description:
      'Sends investigation lifecycle messages and records their delivery in the notification routing attachment.',
    inputSchema,
    outputSchema,
    handler: createSendNotificationsHandler({
      send: (context, options) => sendInvestigationNotifications(deps, context, options),
    }),
  });

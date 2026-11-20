/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler, StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { sendInvestigationNotifications } from '../lib/notifications/send_investigation_notifications';
import { inputSchema } from './send_notifications_schema';
import type { outputSchema } from '../step_definitions/send_notifications';
type Send = (
  context: StepHandlerContext,
  options: Parameters<typeof sendInvestigationNotifications>[2]
) => ReturnType<typeof sendInvestigationNotifications>;
export const createSendNotificationsHandler =
  ({ send }: { send: Send }): StepHandler<typeof inputSchema, typeof outputSchema> =>
  async (context) => {
    const { investigation_id: investigationId, phase, reason } = inputSchema.parse(context.input);
    const output = await send(context, {
      investigationId,
      phase,
      reason,
    });
    return { output };
  };

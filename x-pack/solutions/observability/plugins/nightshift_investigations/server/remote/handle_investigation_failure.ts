/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler, StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { sendInvestigationNotifications } from '../lib/notifications/send_investigation_notifications';
import { inputSchema } from './handle_investigation_failure_schema';
import type { outputSchema } from '../step_definitions/handle_investigation_failure';
type Send = (
  context: StepHandlerContext,
  options: Parameters<typeof sendInvestigationNotifications>[2]
) => ReturnType<typeof sendInvestigationNotifications>;
export const createHandleInvestigationFailureHandler =
  ({
    send,
    ensureForFailure,
    emitFailure,
  }: {
    send: Send;
    ensureForFailure: (context: StepHandlerContext, investigationId: string) => Promise<void>;
    emitFailure: (context: StepHandlerContext, investigationId: string) => Promise<void>;
  }): StepHandler<typeof inputSchema, typeof outputSchema> =>
  async (context) => {
    if (context.abortSignal.aborted) {
      return { output: { sent: 0, failed: 0, unconfirmed: 0 } };
    }
    const { investigation_id: investigationId, reason } = inputSchema.parse(context.input);
    await ensureForFailure(context, investigationId);
    const output = await send(context, {
      investigationId,
      phase: 'failed',
      reason,
      onTerminalPhaseSelected: async () => {
        try {
          await emitFailure(context, investigationId);
        } catch (error) {
          context.logger.warn(`Could not emit investigation failure: ${error.message}`);
        }
      },
    });
    return { output };
  };

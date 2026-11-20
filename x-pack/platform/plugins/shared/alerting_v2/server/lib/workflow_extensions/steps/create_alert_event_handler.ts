/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ExecutionError } from '@kbn/workflows-runtime';
import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { CreateAlertEventData } from '@kbn/alerting-v2-schemas/src/create_alert_event_data_schema';
import type { AlertEventsClientApi } from '../../../types';

export const createAlertEventHandler =
  (
    getAlertEventsClient: (context: StepHandlerContext) => Promise<AlertEventsClientApi>,
    checkAlertWritePrivilege: (context: StepHandlerContext) => Promise<boolean>,
    parseInput: (input: unknown) => CreateAlertEventData | Promise<CreateAlertEventData>
  ) =>
  async (context: StepHandlerContext) => {
    const canWrite = await checkAlertWritePrivilege(context);
    if (!canWrite) {
      throw new ExecutionError({
        type: 'PermissionError',
        message: 'Insufficient privileges to create alert events',
      });
    }

    const client = await getAlertEventsClient(context);

    try {
      const parsed = await parseInput(context.input);
      const result = await client.createAlertEvent(parsed, {
        abortSignal: context.abortSignal,
      });
      return { output: result };
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      if (context.abortSignal.aborted) throw error;
      if (error instanceof Error && error.name === 'ZodError') {
        throw new ExecutionError({
          type: 'ValidationError',
          message: error.message,
          details: { name: error.name, message: error.message },
        });
      }
      throw new ExecutionError({
        type: 'ApiError',
        message: error instanceof Error ? error.message : 'Failed to create alert event',
        details: error instanceof Error ? { name: error.name, message: error.message } : {},
      });
    }
  };

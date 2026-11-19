/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { deleteKiInputSchema, deleteKiOutputSchema } from '../../common/step_types/delete_ki';
import type { KiHandlerOperations } from './ki_handler_operations';
import { toStepError } from './to_step_error';

export const createDeleteKiHandler =
  ({ assertEnabled, withTelemetry, checkWritePrivilege, resolve, remove }: KiHandlerOperations) =>
  async (context: StepHandlerContext<typeof deleteKiInputSchema, typeof deleteKiOutputSchema>) => {
    try {
      await assertEnabled();

      const { ai_index_id: aiIndexId, ki_id: kiId, refresh = false } = context.input;
      return await withTelemetry(aiIndexId, async (setManaged) => {
        await checkWritePrivilege();

        const { dest, managed } = await resolve(aiIndexId);
        setManaged(managed);

        const result = await remove({
          aiIndexId,
          dest,
          kiId,
          refresh,
          abortSignal: context.abortSignal,
        });

        return { output: result };
      });
    } catch (error) {
      throw toStepError(error, 'Failed to delete knowledge indicator');
    }
  };

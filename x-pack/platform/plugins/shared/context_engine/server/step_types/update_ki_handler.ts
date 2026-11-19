/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { updateKiInputSchema, updateKiOutputSchema } from '../../common/step_types/update_ki';
import type { KiHandlerOperations } from './ki_handler_operations';
import { toStepError } from './to_step_error';
import { omitNullKiAttributes } from '../../common/step_types/ki_normalization';

export const createUpdateKiHandler =
  ({ assertEnabled, withTelemetry, checkWritePrivilege, resolve, update }: KiHandlerOperations) =>
  async (context: StepHandlerContext<typeof updateKiInputSchema, typeof updateKiOutputSchema>) => {
    try {
      await assertEnabled();

      const {
        ai_index_id: aiIndexId,
        ki_id: kiId,
        lifecycle,
        force = false,
        refresh = false,
      } = context.input;
      const ki = omitNullKiAttributes(context.input.ki);
      return await withTelemetry(aiIndexId, async (setManaged) => {
        await checkWritePrivilege();

        const { dest, managed } = await resolve(aiIndexId);
        setManaged(managed);

        const result = await update({
          aiIndexId,
          dest,
          kiId,
          ki,
          force,
          lifecycle,
          refresh,
          abortSignal: context.abortSignal,
        });

        return { output: result };
      });
    } catch (error) {
      throw toStepError(error, 'Failed to update knowledge indicator');
    }
  };

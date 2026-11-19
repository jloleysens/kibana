/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import { v4 as uuidv4 } from 'uuid';
import type { createKiInputSchema, createKiOutputSchema } from '../../common/step_types/create_ki';
import type { KiHandlerOperations } from './ki_handler_operations';
import { assertWritableDest } from './ki_handler_operations';
import { omitNullKiAttributes } from '../../common/step_types/ki_normalization';

export const createCreateKiHandler =
  ({
    assertEnabled,
    withTelemetry,
    checkWritePrivilege,
    resolve,
    verifyKi,
    put,
  }: KiHandlerOperations) =>
  async (context: StepHandlerContext<typeof createKiInputSchema, typeof createKiOutputSchema>) => {
    await assertEnabled();

    const { ai_index_id: aiIndexId, ki_id: kiId, verifiers, refresh = false } = context.input;
    const ki = omitNullKiAttributes(context.input.ki);
    return withTelemetry(aiIndexId, async (setManaged) => {
      await checkWritePrivilege();

      const verification = verifiers ? await verifyKi({ ki, verifiers, aiIndexId }) : undefined;
      const verificationFailed = verification?.passed === false;

      const { dest, managed } = await resolve(aiIndexId);
      setManaged(managed);
      assertWritableDest(aiIndexId, dest);

      const id = kiId ?? uuidv4();
      const now = new Date().toISOString();
      await put({
        aiIndexId,
        dest,
        kiId: id,
        document: {
          '@timestamp': now,
          ...ki,
          id,
          updated_at: now,
          governance: {
            ...(verificationFailed && { lifecycle: { status: 'verification_failed' } }),
          },
        },
        refresh,
        abortSignal: context.abortSignal,
      });

      return { output: { id, ...(verification && { verification }) } };
    });
  };

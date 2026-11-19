/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import { ExecutionError } from '@kbn/workflows/server';
import { CONTEXT_ENGINE_ENABLED_SETTING_ID } from '@kbn/management-settings-ids';
import type { VerifyKiStepCommonDefinition } from '../../common/step_types/verify_ki_step';
import { omitNullKiAttributes } from '../../common/step_types/ki_normalization';
import type { KiHandlerOperations } from './ki_handler_operations';

export const createVerifyKiHandler =
  (isEnabled: () => Promise<boolean>, verifyKi: KiHandlerOperations['verifyKi']) =>
  async (
    context: StepHandlerContext<
      typeof VerifyKiStepCommonDefinition.inputSchema,
      typeof VerifyKiStepCommonDefinition.outputSchema
    >
  ) => {
    if (!(await isEnabled())) {
      throw new ExecutionError({
        type: 'FeatureDisabledError',
        message: `Context Engine is disabled. Enable the ${CONTEXT_ENGINE_ENABLED_SETTING_ID} advanced setting to verify knowledge indicators.`,
      });
    }

    const {
      ki,
      verifiers,
      ai_index_id: aiIndexId,
      total_timeout_sec: totalTimeoutSec,
    } = context.input;
    const summary = await verifyKi({
      ki: omitNullKiAttributes(ki),
      verifiers,
      aiIndexId,
      totalTimeoutSec,
    });
    return { output: summary };
  };

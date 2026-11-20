/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreSetup } from '@kbn/core/server';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { VerifyKiStepCommonDefinition } from '../../common/step_types/verify_ki_step';
import { isContextEngineEnabledInSpace } from '../utils/is_context_engine_enabled_in_space';
import type { VerifyKi } from './verify_ki';
import { createVerifyKiHandler } from './verify_ki_handler';

export const createVerifyKiStepDefinition = (coreSetup: CoreSetup, verifyKi: VerifyKi) =>
  createServerStepDefinition({
    ...VerifyKiStepCommonDefinition,
    handler: (context) =>
      createVerifyKiHandler(
        async () => {
          const [coreStart] = await coreSetup.getStartServices();
          return isContextEngineEnabledInSpace({
            savedObjects: coreStart.savedObjects,
            uiSettings: coreStart.uiSettings,
            spaceId: context.contextManager.getContext().workflow.spaceId,
          });
        },
        (params) => verifyKi({ ...params, context })
      )(context),
  });

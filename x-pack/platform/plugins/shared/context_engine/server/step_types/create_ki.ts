/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { createKiStepCommonDefinition } from '../../common/step_types/create_ki';
import type { KiStepDependencies } from './helpers';
import type { VerifyKi } from './verify_ki';
import { createDefaultKiHandlerOperations } from './ki_handler_operations_default';
import { createCreateKiHandler } from './create_ki_handler';

export const getCreateKiStepDefinition = (
  dependencies: KiStepDependencies & { verifyKi: VerifyKi }
) =>
  createServerStepDefinition({
    ...createKiStepCommonDefinition,
    handler: (context) =>
      createCreateKiHandler(createDefaultKiHandlerOperations(context, dependencies, 'create'))(
        context
      ),
  });

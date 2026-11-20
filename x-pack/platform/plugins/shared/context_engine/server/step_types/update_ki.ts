/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { updateKiStepCommonDefinition } from '../../common/step_types/update_ki';
import type { KiStepDependencies } from './helpers';
import { createDefaultKiHandlerOperations } from './ki_handler_operations_default';
import { createUpdateKiHandler } from './update_ki_handler';

export const getUpdateKiStepDefinition = (dependencies: KiStepDependencies) =>
  createServerStepDefinition({
    ...updateKiStepCommonDefinition,
    handler: (context) =>
      createUpdateKiHandler(createDefaultKiHandlerOperations(context, dependencies, 'update'))(
        context
      ),
  });

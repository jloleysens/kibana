/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { deleteKiStepCommonDefinition } from '../../common/step_types/delete_ki';
import type { KiStepDependencies } from './helpers';
import { createDefaultKiHandlerOperations } from './ki_handler_operations_default';
import { createDeleteKiHandler } from './delete_ki_handler';

export const getDeleteKiStepDefinition = (dependencies: KiStepDependencies) =>
  createServerStepDefinition({
    ...deleteKiStepCommonDefinition,
    handler: (context) =>
      createDeleteKiHandler(createDefaultKiHandlerOperations(context, dependencies, 'delete'))(
        context
      ),
  });

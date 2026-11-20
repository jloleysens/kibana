/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { createExceptionListItemStepCommonDefinition } from '../../../../common/workflows/step_types/create_exception_list_item_step/create_exception_list_item_step_common';
import { handleCreateExceptionListItemStep } from './create_exception_list_item_step_runtime';

export const createExceptionListItemStepDefinition = createServerStepDefinition({
  ...createExceptionListItemStepCommonDefinition,
  handler: handleCreateExceptionListItemStep,
});

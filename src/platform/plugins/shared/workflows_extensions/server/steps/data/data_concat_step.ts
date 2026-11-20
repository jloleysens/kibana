/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { handleDataConcatStep } from './data_concat_runtime';
import { dataConcatStepCommonDefinition } from '../../../common/steps/data';
import { createServerStepDefinition } from '../../step_registry/types';
export { MAX_CONCAT_ITEMS } from './data_concat_runtime';

export const dataConcatStepDefinition = createServerStepDefinition({
  ...dataConcatStepCommonDefinition,
  handler: handleDataConcatStep,
});

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { createRuleExceptionStepCommonDefinition } from '../../../../common/workflows/step_types/create_rule_exception_step/create_rule_exception_step_common';
import { handleCreateRuleExceptionStep } from './create_rule_exception_step_runtime';

export const createRuleExceptionStepDefinition = createServerStepDefinition({
  ...createRuleExceptionStepCommonDefinition,
  handler: handleCreateRuleExceptionStep,
});

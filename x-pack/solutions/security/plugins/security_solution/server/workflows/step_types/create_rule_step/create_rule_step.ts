/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { createRuleStepCommonDefinition } from '../../../../common/workflows/step_types/create_rule_step/create_rule_step_common';
import { handleCreateRuleStep } from './create_rule_step_runtime';

export const createRuleStepDefinition = createServerStepDefinition({
  ...createRuleStepCommonDefinition,
  handler: handleCreateRuleStep,
});

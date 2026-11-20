/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { enableRuleStepCommonDefinition } from '../../../../common/workflows/step_types/enable_rule_step/enable_rule_step_common';
import { handleEnableRuleStep } from './enable_rule_step_runtime';

export const enableRuleStepDefinition = createServerStepDefinition({
  ...enableRuleStepCommonDefinition,
  handler: handleEnableRuleStep,
});

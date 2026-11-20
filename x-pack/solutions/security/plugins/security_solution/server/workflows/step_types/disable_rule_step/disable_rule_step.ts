/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { disableRuleStepCommonDefinition } from '../../../../common/workflows/step_types/disable_rule_step/disable_rule_step_common';
import { handleDisableRuleStep } from './disable_rule_step_runtime';

export const disableRuleStepDefinition = createServerStepDefinition({
  ...disableRuleStepCommonDefinition,
  handler: handleDisableRuleStep,
});

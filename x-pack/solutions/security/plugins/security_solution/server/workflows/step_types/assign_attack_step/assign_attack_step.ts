/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { assignAttackStepCommonDefinition } from '../../../../common/workflows/step_types/assign_attack_step/assign_attack_step_common';
import { handleAssignAttackStep } from './assign_attack_step_runtime';

export const assignAttackStepDefinition = createServerStepDefinition({
  ...assignAttackStepCommonDefinition,
  handler: handleAssignAttackStep,
});

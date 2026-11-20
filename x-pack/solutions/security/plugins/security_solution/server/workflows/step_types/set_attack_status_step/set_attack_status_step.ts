/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { setAttackStatusStepCommonDefinition } from '../../../../common/workflows/step_types/set_attack_status_step/set_attack_status_step_common';
import { handleSetAttackStatusStep } from './set_attack_status_step_runtime';

export const setAttackStatusStepDefinition = createServerStepDefinition({
  ...setAttackStatusStepCommonDefinition,
  handler: handleSetAttackStatusStep,
});

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { setAttackTagsStepCommonDefinition } from '../../../../common/workflows/step_types/set_attack_tags_step/set_attack_tags_step_common';
import { handleSetAttackTagsStep } from './set_attack_tags_step_runtime';

export const setAttackTagsStepDefinition = createServerStepDefinition({
  ...setAttackTagsStepCommonDefinition,
  handler: handleSetAttackTagsStep,
});

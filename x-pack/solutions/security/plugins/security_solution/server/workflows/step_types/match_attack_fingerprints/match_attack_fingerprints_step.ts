/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server/step_registry/types';
import { matchAttackFingerprintsStepCommonDefinition } from '../../../../common/workflows/step_types/match_attack_fingerprints/match_attack_fingerprints_step_common';
import { createMatchAttackFingerprintsStepHandler } from './match_attack_fingerprints_step_runtime';

export const matchAttackFingerprintsStepDefinition = createServerStepDefinition({
  ...matchAttackFingerprintsStepCommonDefinition,
  handler: createMatchAttackFingerprintsStepHandler(),
});

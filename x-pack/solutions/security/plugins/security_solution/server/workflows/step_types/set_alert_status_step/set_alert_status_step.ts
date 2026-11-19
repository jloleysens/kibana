/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { setAlertStatusStepCommonDefinition } from '../../../../common/workflows/step_types/set_alert_status_step/set_alert_status_step_common';
import { handleSetAlertStatusStep } from './set_alert_status_step_runtime';

export const setAlertStatusStepDefinition = createServerStepDefinition({
  ...setAlertStatusStepCommonDefinition,
  handler: handleSetAlertStatusStep,
});

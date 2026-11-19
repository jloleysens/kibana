/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { setAlertTagsStepCommonDefinition } from '../../../../common/workflows/step_types/set_alert_tags_step/set_alert_tags_step_common';
import { handleSetAlertTagsStep } from './set_alert_tags_step_runtime';

export const setAlertTagsStepDefinition = createServerStepDefinition({
  ...setAlertTagsStepCommonDefinition,
  handler: handleSetAlertTagsStep,
});

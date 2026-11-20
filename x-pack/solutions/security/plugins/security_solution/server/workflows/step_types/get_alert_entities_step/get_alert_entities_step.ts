/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server/step_registry/types';
import { getAlertEntitiesStepCommonDefinition } from '../../../../common/workflows/step_types/get_alert_entities_step/get_alert_entities_step_common';
import { handleGetAlertEntitiesStep } from './get_alert_entities_step_runtime';

export const getAlertEntitiesStepDefinition = createServerStepDefinition({
  ...getAlertEntitiesStepCommonDefinition,
  handler: handleGetAlertEntitiesStep,
});

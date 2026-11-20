/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import type { KibanaRequest } from '@kbn/core/server';
import { createAlertEventDataSchema } from '@kbn/alerting-v2-schemas/src/create_alert_event_data_schema';
import { createAlertEventStepCommonDefinition } from '../../../../common/workflows/steps/create_alert_event_step_common';
import type { AlertEventsClientApi } from '../../../types';
import { createAlertEventHandler } from './create_alert_event_handler';

export function getCreateAlertEventStepDefinition(
  getAlertEventsClient: (request: KibanaRequest) => Promise<AlertEventsClientApi>,
  checkAlertWritePrivilege: (request: KibanaRequest) => Promise<boolean>
) {
  return createServerStepDefinition({
    ...createAlertEventStepCommonDefinition,
    handler: async (context) => {
      const request = context.contextManager.getFakeRequest();
      return createAlertEventHandler(
        () => getAlertEventsClient(request),
        () => checkAlertWritePrivilege(request),
        (input) => createAlertEventDataSchema.parse(input)
      )(context);
    },
  });
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler, RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { remotable } from '@kbn/core-remote-common';
import { DETECTION_ENGINE_SIGNALS_STATUS_URL } from '../../../../common/api_urls';
import type { setAlertStatusStepCommonDefinition } from '../../../../common/workflows/step_types/set_alert_status_step/set_alert_status_step_common';
import { toApiExecutionError } from '../../utils/to_api_execution_error';

export const handleSetAlertStatusStep: StepHandler<
  typeof setAlertStatusStepCommonDefinition.inputSchema,
  typeof setAlertStatusStepCommonDefinition.outputSchema
> = async (context) => {
  const { alert_ids: alertIds, status } = context.input;
  const closeReason = 'close_reason' in context.input ? context.input.close_reason : undefined;

  const signalIds = Array.isArray(alertIds) ? alertIds : [alertIds];

  try {
    await context.contextManager.callKibanaApi<{
      took?: number;
      errors?: boolean;
      items?: unknown[];
    }>({
      method: 'POST',
      path: DETECTION_ENGINE_SIGNALS_STATUS_URL,
      body: {
        signal_ids: signalIds,
        status,
        ...(closeReason ? { reason: closeReason } : {}),
      },
    });

    return {
      output: {
        success: true,
        message: `Successfully updated status to ${status} for ${signalIds.length} alert(s)`,
      },
    };
  } catch (error) {
    throw toApiExecutionError(error, 'set alert status');
  }
};

/** Runs the same handler as in-Kibana without importing its authoring schemas. */
@remotable()
export class SetAlertStatusStep {
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [, , { handlerContext }] = args;
    if (!handlerContext)
      throw new Error('security.setAlertStatus requires executor-local handler context');
    return handleSetAlertStatusStep(
      handlerContext as Parameters<typeof handleSetAlertStatusStep>[0]
    );
  }
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler, RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { remotable } from '@kbn/core-remote-common';
import { DETECTION_ENGINE_ALERT_ASSIGNEES_URL } from '../../../../common/api_urls';
import type { assignAlertStepCommonDefinition } from '../../../../common/workflows/step_types/assign_alert_step/assign_alert_step_common';
import { toApiExecutionError } from '../../utils/to_api_execution_error';

export const handleAssignAlertStep: StepHandler<
  typeof assignAlertStepCommonDefinition.inputSchema,
  typeof assignAlertStepCommonDefinition.outputSchema
> = async (context) => {
  const { alert_ids: alertIds, assignees_to_add: add, assignees_to_remove: remove } = context.input;

  const signalIds = Array.isArray(alertIds) ? alertIds : [alertIds];

  try {
    await context.contextManager.callKibanaApi<{
      took?: number;
      errors?: boolean;
      items?: unknown[];
    }>({
      method: 'POST',
      path: DETECTION_ENGINE_ALERT_ASSIGNEES_URL,
      body: {
        ids: signalIds,
        assignees: {
          add,
          remove,
        },
      },
    });

    return {
      output: {
        success: true,
        message: `Successfully updated assignees for ${signalIds.length} alert(s)`,
      },
    };
  } catch (error) {
    throw toApiExecutionError(error, 'assign alert');
  }
};

/** Runs the same handler as in-Kibana without importing its authoring schemas. */
@remotable()
export class AssignAlertStep {
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [, , { handlerContext }] = args;
    if (!handlerContext)
      throw new Error('security.assignAlert requires executor-local handler context');
    return handleAssignAlertStep(handlerContext as Parameters<typeof handleAssignAlertStep>[0]);
  }
}

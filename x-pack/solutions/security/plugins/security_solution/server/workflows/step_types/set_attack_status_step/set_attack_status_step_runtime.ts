/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler, RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { remotable } from '@kbn/core-remote-common';
import { DETECTION_ENGINE_ATTACKS_STATUS_URL } from '../../../../common/api_urls';
import type { setAttackStatusStepCommonDefinition } from '../../../../common/workflows/step_types/set_attack_status_step/set_attack_status_step_common';
import { toApiExecutionError } from '../../utils/to_api_execution_error';

export const handleSetAttackStatusStep: StepHandler<
  typeof setAttackStatusStepCommonDefinition.inputSchema,
  typeof setAttackStatusStepCommonDefinition.outputSchema
> = async (context) => {
  const { ids, status, update_related_alerts: updateRelatedAlerts } = context.input;
  const reason = 'reason' in context.input ? context.input.reason : undefined;

  const attackIds = Array.isArray(ids) ? ids : [ids];

  try {
    await context.contextManager.callKibanaApi<{
      took?: number;
      errors?: boolean;
      items?: unknown[];
    }>({
      method: 'POST',
      path: DETECTION_ENGINE_ATTACKS_STATUS_URL,
      body: {
        ids: attackIds,
        status,
        update_related_alerts: updateRelatedAlerts,
        ...(reason ? { reason } : {}),
      },
    });

    return {
      output: {
        success: true,
        message: `Successfully updated status to ${status} for ${attackIds.length} attack(s)`,
      },
    };
  } catch (error) {
    throw toApiExecutionError(error, 'set attack status');
  }
};

/** Runs the same handler as in-Kibana without importing its authoring schemas. */
@remotable()
export class SetAttackStatusStep {
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [, , { handlerContext }] = args;
    if (!handlerContext)
      throw new Error('security.setAttackStatus requires executor-local handler context');
    return handleSetAttackStatusStep(
      handlerContext as Parameters<typeof handleSetAttackStatusStep>[0]
    );
  }
}

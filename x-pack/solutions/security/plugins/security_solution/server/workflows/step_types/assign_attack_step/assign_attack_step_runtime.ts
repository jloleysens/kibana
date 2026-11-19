/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler, RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { remotable } from '@kbn/core-remote-common';
import { ExecutionError } from '@kbn/workflows-runtime';
import { DETECTION_ENGINE_ATTACKS_ASSIGNEES_URL } from '../../../../common/api_urls';
import type { assignAttackStepCommonDefinition } from '../../../../common/workflows/step_types/assign_attack_step/assign_attack_step_common';

export const handleAssignAttackStep: StepHandler<
  typeof assignAttackStepCommonDefinition.inputSchema,
  typeof assignAttackStepCommonDefinition.outputSchema
> = async (context) => {
  const {
    ids,
    assignees_to_add: add,
    assignees_to_remove: remove,
    update_related_alerts: updateRelatedAlerts,
  } = context.input;

  const attackIds = Array.isArray(ids) ? ids : [ids];

  try {
    const { status: responseStatus, body } = await context.contextManager.callKibanaApi<{
      took?: number;
      errors?: boolean;
      items?: unknown[];
    }>({
      method: 'POST',
      path: DETECTION_ENGINE_ATTACKS_ASSIGNEES_URL,
      body: {
        ids: attackIds,
        assignees: {
          add,
          remove,
        },
        update_related_alerts: updateRelatedAlerts,
      },
    });

    if (responseStatus >= 400) {
      throw new ExecutionError({
        type: 'ApiError',
        message: `Failed to assign attack: HTTP ${responseStatus}`,
        details: { body },
      });
    }

    return {
      output: {
        success: true,
        message: `Successfully updated assignees for ${attackIds.length} attack(s)`,
      },
    };
  } catch (error) {
    if (error instanceof ExecutionError) {
      throw error;
    }
    throw new ExecutionError({
      type: 'ApiError',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
      details: { error },
    });
  }
};

/** Runs the same handler as in-Kibana without importing its authoring schemas. */
@remotable()
export class AssignAttackStep {
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [, , { handlerContext }] = args;
    if (!handlerContext)
      throw new Error('security.assignAttack requires executor-local handler context');
    return handleAssignAttackStep(handlerContext as Parameters<typeof handleAssignAttackStep>[0]);
  }
}

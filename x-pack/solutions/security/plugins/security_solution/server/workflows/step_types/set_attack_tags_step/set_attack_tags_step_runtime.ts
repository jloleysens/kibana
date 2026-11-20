/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler, RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { remotable } from '@kbn/core-remote-common';
import { ExecutionError } from '@kbn/workflows-runtime';
import { DETECTION_ENGINE_ATTACKS_TAGS_URL } from '../../../../common/api_urls';
import type { setAttackTagsStepCommonDefinition } from '../../../../common/workflows/step_types/set_attack_tags_step/set_attack_tags_step_common';

export const handleSetAttackTagsStep: StepHandler<
  typeof setAttackTagsStepCommonDefinition.inputSchema,
  typeof setAttackTagsStepCommonDefinition.outputSchema
> = async (context) => {
  const {
    ids: attackIds,
    tags_to_add: tagsToAdd = [],
    tags_to_remove: tagsToRemove = [],
    update_related_alerts: updateRelatedAlerts = false,
  } = context.input;
  const ids = Array.isArray(attackIds) ? attackIds : [attackIds];

  try {
    const { status: responseStatus, body } = await context.contextManager.callKibanaApi<
      Record<string, unknown>
    >({
      method: 'POST',
      path: DETECTION_ENGINE_ATTACKS_TAGS_URL,
      body: {
        ids,
        tags: {
          tags_to_add: tagsToAdd,
          tags_to_remove: tagsToRemove,
        },
        update_related_alerts: updateRelatedAlerts,
      },
    });

    if (responseStatus >= 400) {
      throw new ExecutionError({
        type: 'ApiError',
        message: `Failed to set attack tags: HTTP ${responseStatus}`,
        details: { body },
      });
    }

    const addedCount = tagsToAdd.length;
    const removedCount = tagsToRemove.length;
    const parts: string[] = [];
    if (addedCount > 0) parts.push(`added ${addedCount} tag(s)`);
    if (removedCount > 0) parts.push(`removed ${removedCount} tag(s)`);

    return {
      output: {
        success: true,
        message: `Successfully ${parts.join(' and ')} on ${ids.length} attack(s)`,
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
export class SetAttackTagsStep {
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [, , { handlerContext }] = args;
    if (!handlerContext)
      throw new Error('security.setAttackTags requires executor-local handler context');
    return handleSetAttackTagsStep(handlerContext as Parameters<typeof handleSetAttackTagsStep>[0]);
  }
}

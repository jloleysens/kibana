/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler, RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { remotable } from '@kbn/core-remote-common';
import { DETECTION_ENGINE_ALERT_TAGS_URL } from '../../../../common/api_urls';
import type { setAlertTagsStepCommonDefinition } from '../../../../common/workflows/step_types/set_alert_tags_step/set_alert_tags_step_common';
import { toApiExecutionError } from '../../utils/to_api_execution_error';

export const handleSetAlertTagsStep: StepHandler<
  typeof setAlertTagsStepCommonDefinition.inputSchema,
  typeof setAlertTagsStepCommonDefinition.outputSchema
> = async (context) => {
  // zod `.default([])` doesn't apply at runtime: the engine renders `context.input` from the
  // `with` block via `renderValueAccordingToContext` and never runs `inputSchema.parse()`. The
  // sibling `setAlertStatus` handler probes for `close_reason` via `in` for the same reason.
  const {
    alert_ids: alertIds,
    tags_to_add: tagsToAdd = [],
    tags_to_remove: tagsToRemove = [],
  } = context.input;
  const ids = Array.isArray(alertIds) ? alertIds : [alertIds];

  try {
    await context.contextManager.callKibanaApi<{
      version?: string | number;
      updated?: number;
      failures?: unknown[];
    }>({
      method: 'POST',
      path: DETECTION_ENGINE_ALERT_TAGS_URL,
      body: {
        ids,
        tags: {
          tags_to_add: tagsToAdd,
          tags_to_remove: tagsToRemove,
        },
      },
    });

    const addedCount = tagsToAdd.length;
    const removedCount = tagsToRemove.length;
    const parts: string[] = [];
    if (addedCount > 0) parts.push(`added ${addedCount} tag(s)`);
    if (removedCount > 0) parts.push(`removed ${removedCount} tag(s)`);

    return {
      output: {
        success: true,
        message: `Successfully ${parts.join(' and ')} on ${ids.length} alert(s)`,
      },
    };
  } catch (error) {
    throw toApiExecutionError(error, 'set alert tags');
  }
};

/** Runs the same handler as in-Kibana without importing its authoring schemas. */
@remotable()
export class SetAlertTagsStep {
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [, , { handlerContext }] = args;
    if (!handlerContext)
      throw new Error('security.setAlertTags requires executor-local handler context');
    return handleSetAlertTagsStep(handlerContext as Parameters<typeof handleSetAlertTagsStep>[0]);
  }
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler, RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { remotable } from '@kbn/core-remote-common';
import { NOTE_URL } from '../../../../common/api_urls';
import type { deleteNoteStepCommonDefinition } from '../../../../common/workflows/step_types/delete_note_step/delete_note_step_common';
import { toApiExecutionError } from '../../utils/to_api_execution_error';

export const handleDeleteNoteStep: StepHandler<
  typeof deleteNoteStepCommonDefinition.inputSchema,
  typeof deleteNoteStepCommonDefinition.outputSchema
> = async (context) => {
  const { ids } = context.input;
  const noteIds = Array.isArray(ids) ? ids : [ids];

  try {
    await context.contextManager.callKibanaApi<Record<string, unknown>>({
      method: 'DELETE',
      path: NOTE_URL,
      body: { noteIds },
    });

    return {
      output: {
        success: true,
        message: `Successfully deleted ${noteIds.length} note(s)`,
      },
    };
  } catch (error) {
    throw toApiExecutionError(error, 'delete note');
  }
};

/** Runs the same handler as in-Kibana without importing its authoring schemas. */
@remotable()
export class DeleteNoteStep {
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [, , { handlerContext }] = args;
    if (!handlerContext)
      throw new Error('security.deleteNote requires executor-local handler context');
    return handleDeleteNoteStep(handlerContext as Parameters<typeof handleDeleteNoteStep>[0]);
  }
}

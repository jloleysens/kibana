/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler, RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { remotable } from '@kbn/core-remote-common';
import { NOTE_URL } from '../../../../common/api_urls';
import type { createNoteStepCommonDefinition } from '../../../../common/workflows/step_types/create_note_step/create_note_step_common';
import { toApiExecutionError } from '../../utils/to_api_execution_error';

export const handleCreateNoteStep: StepHandler<
  typeof createNoteStepCommonDefinition.inputSchema,
  typeof createNoteStepCommonDefinition.outputSchema
> = async (context) => {
  const { text, document_id: documentId } = context.input;

  try {
    const { body } = await context.contextManager.callKibanaApi<{
      note?: { noteId?: string };
    }>({
      method: 'PATCH',
      path: NOTE_URL,
      body: {
        note: {
          note: text,
          eventId: documentId,
          timelineId: '',
        },
      },
    });

    const noteId = body?.note?.noteId;

    return {
      output: {
        success: true,
        note_id: noteId,
        message: noteId ? `Successfully created note ${noteId}` : 'Successfully created note',
      },
    };
  } catch (error) {
    throw toApiExecutionError(error, 'create note');
  }
};

/** Runs the same handler as in-Kibana without importing its authoring schemas. */
@remotable()
export class CreateNoteStep {
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [, , { handlerContext }] = args;
    if (!handlerContext)
      throw new Error('security.createNote requires executor-local handler context');
    return handleCreateNoteStep(handlerContext as Parameters<typeof handleCreateNoteStep>[0]);
  }
}

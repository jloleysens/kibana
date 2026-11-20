/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler, RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { remotable } from '@kbn/core-remote-common';
import { NOTE_URL } from '../../../../common/api_urls';
import type { getNotesStepCommonDefinition } from '../../../../common/workflows/step_types/get_notes_step/get_notes_step_common';
import { toApiExecutionError } from '../../utils/to_api_execution_error';

interface ApiNote {
  noteId?: string | null;
  note?: string | null;
  eventId?: string | null;
  timelineId?: string | null;
  createdBy?: string | null;
  created?: number | null;
  updatedBy?: string | null;
  updated?: number | null;
  version?: string | null;
}

export const handleGetNotesStep: StepHandler<
  typeof getNotesStepCommonDefinition.inputSchema,
  typeof getNotesStepCommonDefinition.outputSchema
> = async (context) => {
  const { document_id: documentId } = context.input;

  try {
    const { body } = await context.contextManager.callKibanaApi<{
      totalCount?: number;
      notes?: ApiNote[];
    }>({
      method: 'GET',
      path: NOTE_URL,
      query: { documentIds: documentId },
    });

    const notes = (body?.notes ?? []).map((note) => ({
      note_id: note.noteId,
      text: note.note,
      document_id: note.eventId,
      timeline_id: note.timelineId,
      created_by: note.createdBy,
      created: note.created,
      updated_by: note.updatedBy,
      updated: note.updated,
      version: note.version,
    }));

    return {
      output: {
        success: true,
        total_count: body?.totalCount ?? notes.length,
        notes,
      },
    };
  } catch (error) {
    throw toApiExecutionError(error, 'get notes');
  }
};

/** Runs the same handler as in-Kibana without importing its authoring schemas. */
@remotable()
export class GetNotesStep {
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [, , { handlerContext }] = args;
    if (!handlerContext)
      throw new Error('security.getNotes requires executor-local handler context');
    return handleGetNotesStep(handlerContext as Parameters<typeof handleGetNotesStep>[0]);
  }
}

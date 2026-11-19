/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { deleteNoteStepCommonDefinition } from '../../../../common/workflows/step_types/delete_note_step/delete_note_step_common';
import { handleDeleteNoteStep } from './delete_note_step_runtime';

export const deleteNoteStepDefinition = createServerStepDefinition({
  ...deleteNoteStepCommonDefinition,
  handler: handleDeleteNoteStep,
});

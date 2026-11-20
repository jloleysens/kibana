/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { updateNoteStepCommonDefinition } from '../../../../common/workflows/step_types/update_note_step/update_note_step_common';
import { handleUpdateNoteStep } from './update_note_step_runtime';

export const updateNoteStepDefinition = createServerStepDefinition({
  ...updateNoteStepCommonDefinition,
  handler: handleUpdateNoteStep,
});

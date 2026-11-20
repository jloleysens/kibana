/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { createNoteStepCommonDefinition } from '../../../../common/workflows/step_types/create_note_step/create_note_step_common';
import { handleCreateNoteStep } from './create_note_step_runtime';

export const createNoteStepDefinition = createServerStepDefinition({
  ...createNoteStepCommonDefinition,
  handler: handleCreateNoteStep,
});

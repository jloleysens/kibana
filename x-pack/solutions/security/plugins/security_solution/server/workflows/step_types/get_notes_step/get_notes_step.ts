/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { getNotesStepCommonDefinition } from '../../../../common/workflows/step_types/get_notes_step/get_notes_step_common';
import { handleGetNotesStep } from './get_notes_step_runtime';

export const getNotesStepDefinition = createServerStepDefinition({
  ...getNotesStepCommonDefinition,
  handler: handleGetNotesStep,
});

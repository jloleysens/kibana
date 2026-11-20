/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { RunStepCommonDefinition } from '../../../../common/step_types/run_step';
import { prepareRun, type RunDependencies } from './prepare_run';
import { createRunHandler } from './run_handler';
export const getRunStepDefinition = (dependencies: RunDependencies) =>
  createServerStepDefinition({
    ...RunStepCommonDefinition,
    handler: createRunHandler((input, context) =>
      prepareRun(input, context.contextManager.getFakeRequest(), context.abortSignal, dependencies)
    ),
  });
export { createRunHandler } from './run_handler';

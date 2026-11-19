/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreSetup } from '@kbn/core/server';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { parseMaxStepSize } from '../utils/parse_max_step_size';
import { AiClassifyStepCommonDefinition } from '../../../../common/steps/ai';
import type { InferenceWorkflowsStartDeps } from '../../../types';
import { createAiClassifyHandler } from './handler';

export const aiClassifyStepDefinition = (coreSetup: CoreSetup<InferenceWorkflowsStartDeps>) =>
  createServerStepDefinition({
    ...AiClassifyStepCommonDefinition,
    handler: createAiClassifyHandler(async () => {
      const [, services] = await coreSetup.getStartServices();
      return { ...services, parseMaxStepSize };
    }),
  });

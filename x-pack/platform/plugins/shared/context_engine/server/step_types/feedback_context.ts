/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { feedbackContextStepCommonDefinition } from '../../common/step_types/feedback_context';
import type { FeedbackAnalysisStepDependencies } from './helpers';
import { createFeedbackContextHandler } from './feedback_context_handler';
import { buildFeedbackContext } from '../feedback_analysis/context';

/** Assembles everything one analysis run reads. */
export const getFeedbackContextStepDefinition = (dependencies: FeedbackAnalysisStepDependencies) =>
  createServerStepDefinition({
    ...feedbackContextStepCommonDefinition,
    handler: createFeedbackContextHandler({
      ...dependencies,
      buildContext: (aiIndexId, spaceId, esClient) =>
        buildFeedbackContext(aiIndexId, spaceId, {
          esClient,
          aiIndexService: dependencies.getAiIndexService(),
          improvementsService: dependencies.getImprovementsService(esClient, spaceId),
        }),
    }),
  });

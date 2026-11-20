/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { recordImprovementsStepCommonDefinition } from '../../common/step_types/record_improvements';
import { assertContextEngineEnabled } from './step_guards';
import type { FeedbackAnalysisStepDependencies } from './helpers';
import { createRecordImprovementsHandler } from './record_improvements_handler';
import { recordImprovementsForIndex } from './record_improvements_operation';

/** Records what an analysis run proposed. */
export const getRecordImprovementsStepDefinition = (
  dependencies: FeedbackAnalysisStepDependencies
) =>
  createServerStepDefinition({
    ...recordImprovementsStepCommonDefinition,
    handler: (context) => {
      const request = context.contextManager.getFakeRequest();
      const spaceId = context.contextManager.getContext().workflow.spaceId;
      return createRecordImprovementsHandler({
        assertEnabled: () =>
          assertContextEngineEnabled(dependencies.isContextEngineEnabled, spaceId),
        isFeedbackLoopEnabled: dependencies.isFeedbackLoopEnabled,
        checkWritePrivilege: () => dependencies.checkWritePrivilege(request, spaceId),
        record: (params) =>
          recordImprovementsForIndex(params, {
            ...dependencies,
            request,
            spaceId,
            esClient: context.contextManager.getScopedEsClient(),
          }),
      })(context);
    },
  });

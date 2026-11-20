/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import { ExecutionError } from '@kbn/workflows-runtime';
import type { Logger } from '@kbn/logging';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { feedbackContextStepCommonDefinition } from '../../common/step_types/feedback_context';
import { AiIndexNotFoundError } from '../ai_indices/errors';
import type { FeedbackAnalysisContext } from '../../common/http_api/feedback_context';
import { InvalidSignalWindowError } from '../feedback_analysis/errors';
import { assertContextEngineEnabled, assertFeedbackLoopEnabled } from './step_guards';

export interface FeedbackContextHandlerDependencies {
  isContextEngineEnabled: (spaceId: string) => Promise<boolean>;
  isFeedbackLoopEnabled: () => Promise<boolean>;
  logger: Pick<Logger, 'debug'>;
  buildContext: (
    aiIndexId: string,
    spaceId: string,
    esClient: ElasticsearchClient
  ) => Promise<FeedbackAnalysisContext>;
}

export const createFeedbackContextHandler =
  ({
    isContextEngineEnabled,
    isFeedbackLoopEnabled,
    logger,
    buildContext,
  }: FeedbackContextHandlerDependencies) =>
  async (context: StepHandlerContext<typeof feedbackContextStepCommonDefinition.inputSchema>) => {
    const spaceId = context.contextManager.getContext().workflow.spaceId;
    await assertContextEngineEnabled(isContextEngineEnabled, spaceId);
    await assertFeedbackLoopEnabled(isFeedbackLoopEnabled);

    const { ai_index_id: aiIndexId } = context.input;
    const esClient = context.contextManager.getScopedEsClient();

    try {
      const {
        agent_id: agentId,
        briefing,
        output_schema: outputSchema,
        has_signals: hasSignals,
        run,
      } = await buildContext(aiIndexId, spaceId, esClient);

      logger.debug(
        () =>
          `Feedback context for AI index '${aiIndexId}': ${run.signal_count} signal(s) from ${run.signal_spaces.length} space(s), analyzable=${hasSignals}`
      );

      return {
        output: {
          agent_id: agentId,
          briefing,
          output_schema: outputSchema,
          has_signals: hasSignals,
          signal_window: run.signal_window,
          signal_spaces: run.signal_spaces,
          signal_count: run.signal_count,
        },
      };
    } catch (error) {
      if (error instanceof AiIndexNotFoundError) {
        throw new ExecutionError({
          type: 'NotFoundError',
          message: `AI index '${aiIndexId}' not found`,
        });
      }
      if (error instanceof InvalidSignalWindowError) {
        throw new ExecutionError({ type: 'ValidationError', message: error.message });
      }
      throw error;
    }
  };

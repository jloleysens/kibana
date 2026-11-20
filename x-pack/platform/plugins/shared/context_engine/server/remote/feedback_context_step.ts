/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { AiIndexNotFoundError } from '../ai_indices/errors';
import { InvalidSignalWindowError } from '../feedback_analysis/errors';
import { createFeedbackContextHandler } from '../step_types/feedback_context_handler';
import { FeedbackOperationsToken, type FeedbackOperationsApi } from './feedback_tokens';
import { restoreRegistryError } from './registry_errors';

export class FeedbackContextStep implements RemoteWorkflowStep {
  constructor(@inject(FeedbackOperationsToken) private readonly registry: FeedbackOperationsApi) {}

  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext)
      throw new Error('Feedback context requires executor-local handler context');
    handlerContext.abortSignal.throwIfAborted();
    const logger = {
      debug: (message: Parameters<import('@kbn/logging').Logger['debug']>[0]) =>
        handlerContext.logger.debug(String(typeof message === 'function' ? message() : message)),
      error: (message: Parameters<import('@kbn/logging').Logger['error']>[0]) =>
        handlerContext.logger.error(String(typeof message === 'function' ? message() : message)),
    };
    const handler = createFeedbackContextHandler({
      buildContext: async (aiIndexId) => {
        const result = await restoreRegistryError(this.registry.buildContext(scopeId, aiIndexId));
        if (result.outcome === 'not-found') throw new AiIndexNotFoundError(aiIndexId);
        if (result.outcome === 'invalid-window') throw new InvalidSignalWindowError(result.message);
        return result.context;
      },
      isContextEngineEnabled: () =>
        restoreRegistryError(this.registry.isContextEngineEnabled(scopeId)),
      isFeedbackLoopEnabled: () =>
        restoreRegistryError(this.registry.isFeedbackLoopEnabled(scopeId)),
      logger,
    });
    recordRemoteTiming('context_engine_feedback_native_handler', { scopeId });
    return handler(handlerContext as Parameters<typeof handler>[0]);
  }
}

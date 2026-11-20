/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { createClassifyDetectionsHandler } from '../step_definitions/classify_detections_handler';
import { SignificantEventsOperationsToken, type SignificantEventsOperationsApi } from './tokens';
import { restoreSignificantEventsError } from './errors';

export class ClassifyDetectionsStep implements RemoteWorkflowStep {
  constructor(
    @inject(SignificantEventsOperationsToken) private readonly api: SignificantEventsOperationsApi
  ) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    if (!context.handlerContext)
      throw new Error('Significant events classifier requires executor-local handler context');
    const { handlerContext } = context;
    const handler = createClassifyDetectionsHandler(async (input, signal) => {
      const reference = await restoreSignificantEventsError(
        this.api.openClassification(scopeId, handlerContext.stepId)
      );
      let cancellation: Promise<void> | undefined;
      const abort = () => {
        cancellation = restoreSignificantEventsError(
          this.api.closeClassification(scopeId, reference)
        ).catch((error: Error) => {
          handlerContext.logger.debug('Significant events cancellation: ' + error.message);
        });
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      try {
        return await restoreSignificantEventsError(this.api.classify(scopeId, reference, input));
      } finally {
        signal.removeEventListener('abort', abort);
        await cancellation;
      }
    });
    recordRemoteTiming('significant_events_classify_native_handler', { scopeId });
    return handler(context.handlerContext as Parameters<typeof handler>[0]);
  }
}

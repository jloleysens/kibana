/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { createResolveModelHandler } from '../step_definitions/resolve_model_handler';
import { SignificantEventsOperationsToken, type SignificantEventsOperationsApi } from './tokens';
import { restoreSignificantEventsError } from './errors';

export class ResolveModelStep implements RemoteWorkflowStep {
  constructor(
    @inject(SignificantEventsOperationsToken) private readonly api: SignificantEventsOperationsApi
  ) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    if (!context.handlerContext)
      throw new Error('Significant events model requires executor-local handler context');
    const handler = createResolveModelHandler((input) =>
      restoreSignificantEventsError(this.api.resolveModel(scopeId, input))
    );
    recordRemoteTiming('significant_events_model_native_handler', { scopeId });
    return handler(context.handlerContext as Parameters<typeof handler>[0]);
  }
}

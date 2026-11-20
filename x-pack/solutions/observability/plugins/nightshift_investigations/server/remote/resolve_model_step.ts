/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import { ModelSelectionToken, type ModelSelectionApi } from './model_selection_tokens';
import { restoreInvestigationError } from './investigation_errors';
import { createResolveModelHandler } from './resolve_model';

export class ResolveModelStep implements RemoteWorkflowStep {
  constructor(@inject(ModelSelectionToken) private readonly models: ModelSelectionApi) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext) throw new Error('Model selection requires executor-local handler context');
    handlerContext.abortSignal.throwIfAborted();
    const handler = createResolveModelHandler((_, input) =>
      restoreInvestigationError(this.models.resolve(scopeId, input))
    );
    recordRemoteTiming('nightshift_native_handler', { scopeId, stepType: 'resolve_model' });
    return handler(handlerContext as Parameters<typeof handler>[0]);
  }
}

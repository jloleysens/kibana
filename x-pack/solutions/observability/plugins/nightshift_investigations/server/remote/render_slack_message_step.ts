/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import { InvestigationsToken, type InvestigationsApi } from './investigations_tokens';
import { restoreInvestigationError } from './investigation_errors';
import { createRenderSlackMessageHandler } from './render_slack_message';

export class RenderSlackMessageStep implements RemoteWorkflowStep {
  constructor(@inject(InvestigationsToken) private readonly investigations: InvestigationsApi) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext)
      throw new Error('RenderSlackMessageStep requires executor-local handler context');
    handlerContext.abortSignal.throwIfAborted();
    const handler = createRenderSlackMessageHandler((_, input) =>
      restoreInvestigationError(this.investigations.getRenderingInput(scopeId, input))
    );
    recordRemoteTiming('nightshift_native_handler', { scopeId, stepType: 'render_slack_message' });
    return handler(handlerContext as Parameters<typeof handler>[0]);
  }
}

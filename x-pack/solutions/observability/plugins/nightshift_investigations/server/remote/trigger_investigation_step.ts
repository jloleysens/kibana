/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import {
  InvestigationDispatchToken,
  type InvestigationDispatchApi,
} from './investigation_dispatch_tokens';
import { createTriggerInvestigationHandler } from './trigger_investigation';
import { restoreDispatchError } from './dispatch_errors';

export class TriggerInvestigationStep implements RemoteWorkflowStep {
  constructor(
    @inject(InvestigationDispatchToken) private readonly dispatch: InvestigationDispatchApi
  ) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext)
      throw new Error('Investigation dispatch requires executor-local handler context');
    handlerContext.abortSignal.throwIfAborted();
    const handler = createTriggerInvestigationHandler({
      prepare: (_, automationId) =>
        restoreDispatchError(this.dispatch.prepare(scopeId, automationId)),
      resolveAlerts: (_, subjectId) =>
        restoreDispatchError(this.dispatch.resolveAlerts(scopeId, subjectId)),
      start: (reference, input) =>
        restoreDispatchError(this.dispatch.start(scopeId, reference, input)),
      notifyQuota: async (_, _slackThread, reference) => {
        const warnings = await restoreDispatchError(
          this.dispatch.notifyQuota(
            scopeId,
            reference,
            handlerContext.contextManager.getContext().kibanaUrl
          )
        );
        for (const warning of warnings) handlerContext.logger.warn(warning);
      },
    });
    recordRemoteTiming('nightshift_native_handler', { scopeId, stepType: 'trigger_investigation' });
    return handler(handlerContext as Parameters<typeof handler>[0]);
  }
}

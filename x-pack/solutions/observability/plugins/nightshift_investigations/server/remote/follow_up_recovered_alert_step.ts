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
import { createFollowUpRecoveredAlertHandler } from './follow_up_recovered_alert';

export class FollowUpRecoveredAlertStep implements RemoteWorkflowStep {
  constructor(@inject(InvestigationsToken) private readonly investigations: InvestigationsApi) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext)
      throw new Error('FollowUpRecoveredAlertStep requires executor-local handler context');
    handlerContext.abortSignal.throwIfAborted();
    const handler = createFollowUpRecoveredAlertHandler((_, input) =>
      restoreInvestigationError(this.investigations.followUpRecoveredAlert(scopeId, input))
    );
    recordRemoteTiming('nightshift_native_handler', {
      scopeId,
      stepType: 'follow_up_recovered_alert',
    });
    return handler(handlerContext as Parameters<typeof handler>[0]);
  }
}

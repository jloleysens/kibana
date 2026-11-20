/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import { DecisionTreePolicyToken, type DecisionTreePolicyApi } from './decision_tree_policy_tokens';
import { restoreInvestigationError } from './investigation_errors';
import { createDecisionTreePrepareHandler } from './decision_tree_prepare';

export class DecisionTreePrepareStep implements RemoteWorkflowStep {
  constructor(@inject(DecisionTreePolicyToken) private readonly policy: DecisionTreePolicyApi) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext)
      throw new Error('Decision tree preparation requires executor-local handler context');
    handlerContext.abortSignal.throwIfAborted();
    const { enabled, telemetryConnectorId } = await restoreInvestigationError(
      this.policy.read(scopeId)
    );
    const handler = createDecisionTreePrepareHandler({
      isEnabled: () => enabled,
      getTelemetryConnectorId: () => telemetryConnectorId,
      logger: handlerContext.logger,
    });
    recordRemoteTiming('nightshift_native_handler', { scopeId, stepType: 'decision_tree_prepare' });
    return handler(handlerContext as Parameters<typeof handler>[0]);
  }
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import { AgentInstallationToken, type AgentInstallationApi } from './agent_installation_tokens';
import { restoreInvestigationError } from './investigation_errors';
import { createEnsureInvestigationAgentHandler } from './ensure_investigation_agent';

export class EnsureInvestigationAgentStep implements RemoteWorkflowStep {
  constructor(@inject(AgentInstallationToken) private readonly agents: AgentInstallationApi) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext)
      throw new Error('Agent installation requires executor-local handler context');
    handlerContext.abortSignal.throwIfAborted();
    const handler = createEnsureInvestigationAgentHandler((_, agentId) =>
      restoreInvestigationError(this.agents.ensure(scopeId, agentId))
    );
    recordRemoteTiming('nightshift_native_handler', {
      scopeId,
      stepType: 'ensure_investigation_agent',
    });
    return handler(handlerContext as Parameters<typeof handler>[0]);
  }
}

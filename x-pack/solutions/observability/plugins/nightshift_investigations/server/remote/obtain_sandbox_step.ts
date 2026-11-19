/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import { SandboxWorkspacesToken, type SandboxWorkspacesApi } from './sandbox_workspaces_tokens';
import { restoreInvestigationError } from './investigation_errors';
import { createObtainSandboxHandler } from './obtain_sandbox';

export class ObtainSandboxStep implements RemoteWorkflowStep {
  constructor(@inject(SandboxWorkspacesToken) private readonly workspaces: SandboxWorkspacesApi) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext)
      throw new Error('Sandbox allocation requires executor-local handler context');
    handlerContext.abortSignal.throwIfAborted();
    const handler = createObtainSandboxHandler((_, conversationId, required) =>
      restoreInvestigationError(this.workspaces.allocate(scopeId, conversationId, required))
    );
    recordRemoteTiming('nightshift_native_handler', { scopeId, stepType: 'obtain_sandbox' });
    return handler(handlerContext as Parameters<typeof handler>[0]);
  }
}

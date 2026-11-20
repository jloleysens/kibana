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
import { DecisionTreePolicyToken, type DecisionTreePolicyApi } from './decision_tree_policy_tokens';
import { createDecisionTreeHydrateHandler } from './decision_tree_hydrate';
import { restoreSandboxError } from './sandbox_errors';

export class DecisionTreeHydrateStep implements RemoteWorkflowStep {
  constructor(
    @inject(SandboxWorkspacesToken) private readonly workspaces: SandboxWorkspacesApi,
    @inject(DecisionTreePolicyToken) private readonly policy: DecisionTreePolicyApi
  ) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext)
      throw new Error('Decision tree hydrate requires executor-local handler context');
    handlerContext.abortSignal.throwIfAborted();
    const handler = createDecisionTreeHydrateHandler({
      logger: handlerContext.logger,
      isEnabled: async () => (await restoreSandboxError(this.policy.read(scopeId))).enabled,
      getSession: async (_, conversationId) => {
        const reference = await restoreSandboxError(
          this.workspaces.openDecisionTreeWorkspace(scopeId, conversationId)
        );
        if (!reference) return undefined;
        return {
          mkdirs: (paths) => restoreSandboxError(this.workspaces.mkdirs(scopeId, reference, paths)),
          writeFiles: (files) =>
            restoreSandboxError(
              this.workspaces.writeFiles(
                scopeId,
                reference,
                files.map(({ path, content }) => ({ path, content: content.toString('utf8') }))
              )
            ),
        };
      },
    });
    recordRemoteTiming('nightshift_native_handler', { scopeId, stepType: 'decision_tree_hydrate' });
    return handler(handlerContext as Parameters<typeof handler>[0]);
  }
}

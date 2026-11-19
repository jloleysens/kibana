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
import { createCortexHydrateHandler } from './cortex_hydrate';
import { restoreSandboxError } from './sandbox_errors';

export class CortexHydrateStep implements RemoteWorkflowStep {
  constructor(@inject(SandboxWorkspacesToken) private readonly workspaces: SandboxWorkspacesApi) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext) throw new Error('Cortex hydrate requires executor-local handler context');
    handlerContext.abortSignal.throwIfAborted();
    const handler = createCortexHydrateHandler({
      logger: handlerContext.logger,
      isEnabled: () => restoreSandboxError(this.workspaces.isCortexEnabled(scopeId)),
      getWorkspace: async (_, conversationId, telemetryConversationId) => {
        const reference = await restoreSandboxError(
          this.workspaces.openCortexWorkspace(scopeId, conversationId, telemetryConversationId)
        );
        if (!reference) return undefined;
        return {
          session: {
            mkdirs: (paths) =>
              restoreSandboxError(this.workspaces.mkdirs(scopeId, reference, paths)),
            writeFiles: (files) =>
              restoreSandboxError(
                this.workspaces.writeFiles(
                  scopeId,
                  reference,
                  files.map(({ path, content }) => ({ path, content: content.toString('utf8') }))
                )
              ),
          },
          telemetry: {
            reportHydrated: async (pages) => {
              try {
                await restoreSandboxError(
                  this.workspaces.reportCortexHydrated(scopeId, reference, [...pages])
                );
              } catch (error) {
                handlerContext.logger.debug(`Failed to report Cortex telemetry: ${error}`);
              }
            },
          },
        };
      },
    });
    recordRemoteTiming('nightshift_native_handler', { scopeId, stepType: 'cortex_hydrate' });
    return handler(handlerContext as Parameters<typeof handler>[0]);
  }
}

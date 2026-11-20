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
import { createMemoryMaterializeHandler } from './memory_materialize_to_sandbox';
import { restoreSandboxError } from './sandbox_errors';

export class MemoryMaterializeToSandboxStep implements RemoteWorkflowStep {
  constructor(@inject(SandboxWorkspacesToken) private readonly workspaces: SandboxWorkspacesApi) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext)
      throw new Error('Memory materialization requires executor-local handler context');
    handlerContext.abortSignal.throwIfAborted();
    const handler = createMemoryMaterializeHandler({
      logger: handlerContext.logger,
      isEnabled: () => restoreSandboxError(this.workspaces.isMemoryEnabled(scopeId)),
      getWorkspace: async (_, conversationId) => {
        const reference = await restoreSandboxError(
          this.workspaces.openMemoryWorkspace(scopeId, conversationId)
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
            statFiles: (paths) =>
              restoreSandboxError(this.workspaces.statFiles(scopeId, reference, paths)),
            readFiles: async (requests) =>
              (
                await restoreSandboxError(this.workspaces.readFiles(scopeId, reference, requests))
              ).map(({ path, contentBase64, success }) => ({
                path,
                content: Buffer.from(contentBase64, 'base64'),
                success,
              })),
          },
          getIsReset: () => restoreSandboxError(this.workspaces.isReset(scopeId, reference)),
          reportMaterialized: async ({ workflow_execution_id, ...event }) => {
            try {
              await restoreSandboxError(
                this.workspaces.reportMemoryMaterialized(scopeId, reference, event)
              );
            } catch (error) {
              handlerContext.logger.debug(`Failed to report Semantic Memory telemetry: ${error}`);
            }
          },
        };
      },
    });
    recordRemoteTiming('nightshift_native_handler', {
      scopeId,
      stepType: 'memory_materialize_to_sandbox',
    });
    return handler(handlerContext as Parameters<typeof handler>[0]);
  }
}

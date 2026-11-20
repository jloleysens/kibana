/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { SandboxSession } from '@kbn/sandbox-plugin/server';
import type { StepHandler } from '@kbn/workflows-extensions/server';
import type { inputSchema, outputSchema } from '../step_definitions/cortex_hydrate';
import type { CortexTelemetry } from '../telemetry/cortex_telemetry';
import { hydrateCortexWorkspaceWithTelemetry } from '../cortex/hydrate_workspace';
import { CORTEX_WORKSPACE_ROOT } from '../cortex/materialize';
import { degradeOnWriterFailure } from '../lib/hydrate_notification';
import { scopeConversationId, unscopeConversationId } from '../tools/sandbox_bash/tool_utils';
import { withTimeout } from '../step_definitions/with_timeout';

const HYDRATE_TIMEOUT_MS = 45_000;
type Handler = StepHandler<typeof inputSchema, typeof outputSchema>;
export const createCortexHydrateHandler =
  ({
    getWorkspace,
    logger,
    isEnabled,
  }: {
    getWorkspace: (
      context: Parameters<Handler>[0],
      conversationId: string,
      telemetryConversationId: string
    ) => Promise<
      | {
          session: Pick<SandboxSession, 'mkdirs' | 'writeFiles'>;
          telemetry: Pick<CortexTelemetry, 'reportHydrated'>;
        }
      | undefined
    >;
    logger: Pick<Logger, 'info' | 'warn' | 'debug'>;
    isEnabled?: () => boolean | Promise<boolean>;
  }): Handler =>
  async (context) => {
    const { sandbox_id: providedSandboxId, conversation_id: conversationId } = context.input;
    const { spaceId } = context.contextManager.getContext().workflow;
    const sandboxId =
      providedSandboxId ??
      (conversationId !== undefined ? scopeConversationId(spaceId, conversationId) : undefined);
    if (sandboxId === undefined) {
      throw new Error('Either sandbox_id or conversation_id is required.');
    }
    const resolvedConversationId = conversationId ?? unscopeConversationId(spaceId, sandboxId);

    if (isEnabled && !(await isEnabled())) {
      context.logger.info(`Skipped Cortex hydrate for sandbox ${sandboxId} (flag off)`);
      return {
        output: {
          sandbox_id: sandboxId,
          conversation_id: resolvedConversationId,
          skipped: true,
          notification: '',
        },
      };
    }

    const workspace = await getWorkspace(
      context,
      unscopeConversationId(spaceId, sandboxId),
      resolvedConversationId
    );
    if (!workspace) {
      throw new Error(
        'The sandbox is not configured — ' +
          'ensure the sandbox plugin is installed and configured.'
      );
    }
    const { session, telemetry } = workspace;

    context.logger.info(`Hydrating Cortex into sandbox ${sandboxId} (space ${spaceId})`);

    // A failed write degrades to a system_update line rather than a failed step:
    // this is a before-agent hook, and aborting the investigator round because one
    // writer could not reach the sandbox is worse than telling the model the
    // directory may be incomplete.
    try {
      await withTimeout(
        (signal) =>
          hydrateCortexWorkspaceWithTelemetry({
            session,
            esClient: context.contextManager.getScopedEsClient(),
            spaceId,
            signal,
            telemetry,
            logger,
          }),
        HYDRATE_TIMEOUT_MS,
        `Cortex hydrate timed out after ${HYDRATE_TIMEOUT_MS}ms`
      );
    } catch (error) {
      return {
        output: {
          sandbox_id: sandboxId,
          conversation_id: resolvedConversationId,
          ...degradeOnWriterFailure({
            logger: context.logger,
            label: 'Cortex hydrate',
            sandboxId,
            directory: CORTEX_WORKSPACE_ROOT,
            error,
          }),
        },
      };
    }

    return {
      output: {
        sandbox_id: sandboxId,
        conversation_id: resolvedConversationId,
        notification: '',
      },
    };
  };

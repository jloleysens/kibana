/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { SandboxSession } from '@kbn/sandbox-plugin/server';
import type { StepHandler } from '@kbn/workflows-extensions/server';
import type { inputSchema, outputSchema } from '../step_definitions/memory_materialize_to_sandbox';
import type { SemanticMemoryMaterializedEvent } from '../telemetry/events';
import { usesKnowledge } from '../agents/agent_policy';
import { hydrateMemoryWorkspaceWithSessionState } from '../memory/hydrate_workspace';
import { MEMORY_WORKSPACE_ROOT } from '../memory/materialize';
import { degradeOnWriterFailure } from '../lib/hydrate_notification';
import { unscopeConversationId } from '../tools/sandbox_bash/tool_utils';
import { withTimeout } from '../step_definitions/with_timeout';

const MATERIALIZE_TIMEOUT_MS = 45_000;
type Handler = StepHandler<typeof inputSchema, typeof outputSchema>;
export const createMemoryMaterializeHandler =
  ({
    getWorkspace,
    logger,
    isEnabled,
  }: {
    getWorkspace: (
      context: Parameters<Handler>[0],
      conversationId: string
    ) => Promise<
      | {
          session: Pick<SandboxSession, 'statFiles' | 'readFiles' | 'mkdirs' | 'writeFiles'>;
          getIsReset: () => boolean | Promise<boolean>;
          reportMaterialized: (event: SemanticMemoryMaterializedEvent) => void | Promise<void>;
        }
      | undefined
    >;
    logger: Pick<Logger, 'info' | 'warn' | 'debug'>;
    isEnabled?: () => boolean | Promise<boolean>;
  }): Handler =>
  async (context) => {
    const {
      sandbox_id: sandboxId,
      prompt,
      agent_id: agentId,
      conversation_id: conversationId,
    } = context.input;
    const workflowContext = context.contextManager.getContext();
    const { spaceId } = workflowContext.workflow;
    const workflowExecutionId = workflowContext.execution.id;

    if (isEnabled && !(await isEnabled())) {
      context.logger.info(`Skipped memory materialize for sandbox ${sandboxId} (flag off)`);
      return {
        output: { sandbox_id: sandboxId, skipped: true, recalled_ids: [], notification: '' },
      };
    }

    const trimmedAgentId = agentId?.trim();
    if (!trimmedAgentId) {
      context.logger.info(`Skipped memory materialize for sandbox ${sandboxId} (missing agent_id)`);
      return {
        output: { sandbox_id: sandboxId, skipped: true, recalled_ids: [], notification: '' },
      };
    }
    if (!usesKnowledge(trimmedAgentId)) {
      context.logger.info('Skipped memory materialize for unsupported agent');
      context.logger.debug(`Memory materialize unsupported agent=${trimmedAgentId}`);
      return {
        output: { sandbox_id: sandboxId, skipped: true, recalled_ids: [], notification: '' },
      };
    }

    const workspace = await getWorkspace(context, unscopeConversationId(spaceId, sandboxId));
    if (!workspace) {
      throw new Error(
        'The sandbox is not configured — ' +
          'ensure the sandbox plugin is installed and configured.'
      );
    }
    const { session, getIsReset, reportMaterialized } = workspace;

    context.logger.info(
      `Materializing semantic memory into sandbox ${sandboxId} (agent ${trimmedAgentId})`
    );
    context.logger.debug(`Memory materialize step promptChars=${prompt?.length ?? 0}`);

    let result: Awaited<ReturnType<typeof hydrateMemoryWorkspaceWithSessionState>>;
    try {
      result = await withTimeout(
        async (signal) =>
          hydrateMemoryWorkspaceWithSessionState({
            session,
            getIsReset,
            esClient: context.contextManager.getScopedEsClient(),
            spaceId,
            agentId: trimmedAgentId,
            query: prompt,
            signal,
            logger,
          }),
        MATERIALIZE_TIMEOUT_MS,
        `Memory materialize to sandbox timed out after ${MATERIALIZE_TIMEOUT_MS}ms`,
        context.abortSignal
      );
    } catch (error) {
      await reportMaterialized({
        agent_id: trimmedAgentId,
        ...(conversationId ? { conversation_id: conversationId } : {}),
        workflow_execution_id: workflowExecutionId,
        outcome: 'failure',
      });
      // Degrade to a system_update line rather than a failed step: this is a
      // before-agent hook, so throwing here aborts the investigator round over one
      // writer that could not reach the sandbox.
      return {
        output: {
          sandbox_id: sandboxId,
          recalled_ids: [],
          ...degradeOnWriterFailure({
            logger: context.logger,
            label: 'Memory materialize',
            sandboxId,
            directory: MEMORY_WORKSPACE_ROOT,
            error,
          }),
        },
      };
    }

    await reportMaterialized({
      agent_id: trimmedAgentId,
      ...(conversationId ? { conversation_id: conversationId } : {}),
      workflow_execution_id: workflowExecutionId,
      outcome: 'success',
      retrieval_mode: result.summary.retrievalMode,
      search_fallback: result.summary.searchFallback,
      candidate_count: result.summary.candidateCount,
      recalled_count: result.summary.recalledCount,
      new_page_count: result.summary.newPageCount,
      catalog_size: result.summary.catalogSize,
      catalog_evicted_count: result.summary.catalogEvictedCount,
      pod_reset: result.summary.podReset,
      notification_chars: result.summary.notificationChars,
    });

    return {
      output: {
        sandbox_id: sandboxId,
        recalled_ids: result.recalledIds,
        notification: result.notification,
      },
    };
  };

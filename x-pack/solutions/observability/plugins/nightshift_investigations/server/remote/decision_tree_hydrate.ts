/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { SandboxSession } from '@kbn/sandbox-plugin/server';
import type { StepHandler } from '@kbn/workflows-extensions/server';
import type { inputSchema, outputSchema } from '../step_definitions/decision_tree_hydrate';
import { hydrateDecisionTreeWorkspace } from '../decision_trees/hydrate_workspace';
import { DECISION_TREE_WORKSPACE_ROOT } from '../decision_trees/materialize';
import { degradeOnWriterFailure } from '../lib/hydrate_notification';
import { unscopeConversationId } from '../tools/sandbox_bash/tool_utils';
import { usesDecisionTrees } from '../agents/agent_policy';
import { withTimeout } from '../step_definitions/with_timeout';

/** Caps beforeAgent so a stuck sandbox write cannot stall the reinforcement round. */
const HYDRATE_TIMEOUT_MS = 20_000;
type Handler = StepHandler<typeof inputSchema, typeof outputSchema>;
export const createDecisionTreeHydrateHandler =
  ({
    getSession,
    logger,
    isEnabled,
  }: {
    getSession: (
      context: Parameters<Handler>[0],
      conversationId: string
    ) => Promise<Pick<SandboxSession, 'mkdirs' | 'writeFiles'> | undefined>;
    logger: Pick<Logger, 'info' | 'debug'>;
    isEnabled?: () => boolean | Promise<boolean>;
  }): Handler =>
  async (context) => {
    const { sandbox_id: sandboxId, prompt, agent_id: agentId } = context.input;
    const { spaceId } = context.contextManager.getContext().workflow;
    const conversationId = unscopeConversationId(spaceId, sandboxId);

    // The combined materialize workflow installs with Cortex or Memory, so this step is
    // registered even when the tree feature is off. Fail closed without touching the sandbox.
    // It is also every knowledge agent's before-agent hook, but only the investigator reads
    // the trees.
    const flagOff = Boolean(isEnabled && !(await isEnabled()));
    if (flagOff || (agentId !== undefined && !usesDecisionTrees(agentId))) {
      context.logger.info(
        `Skipped decision tree hydrate for sandbox ${sandboxId} (${
          flagOff ? 'flag off' : 'agent does not use decision trees'
        })`
      );
      return {
        output: {
          sandbox_id: sandboxId,
          conversation_id: conversationId,
          tree_count: 0,
          skipped: true,
          notification: '',
        },
      };
    }

    // Resolves the same original sandbox session as obtain_sandbox; never a worker filesystem.
    const session = await getSession(context, conversationId);
    if (!session) {
      throw new Error(
        'The sandbox is not configured — ' +
          'ensure the sandbox plugin is installed and configured.'
      );
    }

    context.logger.info(`Hydrating decision trees into sandbox ${sandboxId} (space ${spaceId})`);

    // A failed write degrades to a system_update line rather than a failed step: this
    // step is also a before-agent hook for the reinforcement agent, so throwing would
    // abort that round over one writer.
    let treeCount: number;
    try {
      treeCount = await withTimeout(
        (signal) =>
          hydrateDecisionTreeWorkspace({
            session,
            esClient: context.contextManager.getScopedEsClient(),
            logger,
            spaceId,
            prompt,
            signal,
          }),
        HYDRATE_TIMEOUT_MS,
        `Decision tree hydrate timed out after ${HYDRATE_TIMEOUT_MS}ms`
      );
    } catch (error) {
      return {
        output: {
          sandbox_id: sandboxId,
          conversation_id: conversationId,
          tree_count: 0,
          ...degradeOnWriterFailure({
            logger: context.logger,
            label: 'Decision tree hydrate',
            sandboxId,
            directory: DECISION_TREE_WORKSPACE_ROOT,
            error,
          }),
        },
      };
    }

    return {
      output: {
        sandbox_id: sandboxId,
        conversation_id: conversationId,
        tree_count: treeCount,
        notification: '',
      },
    };
  };

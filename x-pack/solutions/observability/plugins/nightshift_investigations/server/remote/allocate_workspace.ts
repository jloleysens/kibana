/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { SandboxPluginStart } from '@kbn/sandbox-plugin/server';
import { scopeConversationId } from '../tools/sandbox_bash/tool_utils';
import { withTimeout } from '../step_definitions/with_timeout';

/** Caps a stuck sandbox allocate so it cannot stall hydrate or optimize. */
const ALLOCATE_TIMEOUT_MS = 45_000;

/** Keeps allocation, workspace restore and the original retry inside the sandbox service. */
export const createWorkspaceAllocator =
  ({
    getSandboxStart,
    logger,
  }: {
    getSandboxStart: () => SandboxPluginStart | undefined;
    logger: Logger;
  }) =>
  async (
    spaceId: string,
    conversationId: string,
    required: boolean
  ): Promise<{ skipped?: boolean }> => {
    const sandboxId = scopeConversationId(spaceId, conversationId);
    const sandboxStart = getSandboxStart();

    if (!sandboxStart) {
      if (!required) {
        logger.info(`Sandbox is not configured — skipping allocate for ${sandboxId}`);
        return { skipped: true };
      }
      throw new Error(
        'The sandbox is not configured — ' +
          'ensure the sandbox plugin is installed and configured.'
      );
    }

    try {
      const session = sandboxStart.getSessionForSpace(spaceId, conversationId);

      // Stat is enough: the session allocates on the first RPC, including workspace restore.
      const allocate = () =>
        withTimeout(
          (_signal) => session.statFiles(['/workspace']),
          ALLOCATE_TIMEOUT_MS,
          `Sandbox allocate timed out after ${ALLOCATE_TIMEOUT_MS}ms`
        );
      try {
        await allocate();
      } catch (error) {
        logger.warn(
          `Sandbox allocate failed for ${sandboxId}, retrying once: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        await allocate();
      }
    } catch (error) {
      if (required) {
        throw error;
      }
      logger.info(`Sandbox unavailable — skipping allocate for ${sandboxId}`);
      logger.debug(
        `Optional sandbox allocation failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return { skipped: true };
    }

    logger.info(`Obtained sandbox ${sandboxId}`);
    return {};
  };

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { SandboxSession } from '@kbn/sandbox-plugin/server';
import { materializeMemoryWithSessionState, type MaterializeMemoryResult } from './materialize';
import { createMemoryPageStore } from './page_store';
import { previewText } from './log_format';

export const hydrateMemoryWorkspaceWithSessionState = async ({
  session,
  getIsReset,
  esClient,
  spaceId,
  agentId,
  query,
  signal,
  logger,
}: {
  session: Pick<SandboxSession, 'statFiles' | 'readFiles' | 'mkdirs' | 'writeFiles'>;
  getIsReset: () => boolean | Promise<boolean>;
  esClient: ElasticsearchClient;
  spaceId: string;
  agentId: string;
  query?: string;
  signal?: AbortSignal;
  logger: Pick<Logger, 'info' | 'warn' | 'debug'>;
}): Promise<MaterializeMemoryResult> => {
  const store = createMemoryPageStore({ esClient, logger, spaceId, signal });
  logger.debug(
    `Memory hydrate space=${spaceId} agent=${agentId} query=${JSON.stringify(previewText(query))}`
  );
  return materializeMemoryWithSessionState({ session, getIsReset, store, logger, query });
};

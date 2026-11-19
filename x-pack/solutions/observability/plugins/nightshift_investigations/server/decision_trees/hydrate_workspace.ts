/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { SandboxSession } from '@kbn/sandbox-plugin/server';
import { parseAccessedTreesMarker } from './accessed_trees';
import { materializeDecisionTrees } from './materialize';
import { createDecisionTreeStore } from './store';

/** Writes the stored decision trees into the reinforcement agent's sandbox for this round. */
export const hydrateDecisionTreeWorkspace = async ({
  session,
  esClient,
  logger,
  spaceId,
  prompt,
  signal,
}: {
  session: Pick<SandboxSession, 'mkdirs' | 'writeFiles'>;
  esClient: ElasticsearchClient;
  logger: Pick<Logger, 'info' | 'debug'>;
  spaceId: string;
  prompt?: string;
  signal?: AbortSignal;
}): Promise<number> => {
  const store = createDecisionTreeStore({ esClient, logger, spaceId, signal });
  const accessedTreeIds = parseAccessedTreesMarker(prompt);
  const trees = await materializeDecisionTrees({
    session,
    store,
    logger,
    signal,
    ...(accessedTreeIds ? { treeIds: accessedTreeIds } : {}),
  });
  return trees.length;
};

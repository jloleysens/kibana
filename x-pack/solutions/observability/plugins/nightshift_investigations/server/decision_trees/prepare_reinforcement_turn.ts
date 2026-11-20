/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { DecisionTreeTurnKind } from '@kbn/nightshift-decision-trees';
import {
  embedAccessedTreesMarker,
  extractAccessedTreeIds,
  type InvestigationToolCall,
} from './accessed_trees';
import { createLearningStore } from './learning_store';
import { createDecisionTreeStore } from './store';
import { buildReinforcementPrompt } from './turn';

/**
 * Builds the closing message for a completed investigation round: the trees the agent may edit,
 * the learnings already on file, and the turn script for this phase. The round itself is handed
 * to the agent separately, as conversation history.
 */
export const prepareReinforcementTurn = async ({
  response,
  connectorNames,
  esClient,
  logger,
  spaceId,
  signal,
  toolCalls = [],
}: {
  response: string;
  connectorNames: string[];
  esClient: ElasticsearchClient;
  logger: Pick<Logger, 'debug'>;
  spaceId: string;
  signal?: AbortSignal;
  toolCalls?: InvestigationToolCall[];
}): Promise<{ message: string; treeCount: number; turnKind: DecisionTreeTurnKind }> => {
  const [trees, learnings] = await Promise.all([
    createDecisionTreeStore({ esClient, logger, spaceId, signal }).list(),
    createLearningStore({ esClient, logger, spaceId, signal }).list(),
  ]);

  const accessedIds = new Set(extractAccessedTreeIds(toolCalls));
  const accessed = trees.filter(
    (tree) => tree.status !== 'archived' && accessedIds.has(tree.tree_id)
  );
  const { message, turnKind } = buildReinforcementPrompt({
    trees: accessed,
    learnings,
    connectorNames,
    response,
  });
  return {
    message: [embedAccessedTreesMarker(accessed.map((tree) => tree.tree_id)), message].join('\n'),
    treeCount: accessed.length,
    turnKind,
  };
};

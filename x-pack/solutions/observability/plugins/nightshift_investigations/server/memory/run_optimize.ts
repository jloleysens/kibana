/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, KibanaRequest, Logger } from '@kbn/core/server';
import type { ScopedModel } from '@kbn/agent-builder-server';
import type { InvestigationToolCall } from '../decision_trees/accessed_trees';
import { previewText } from './log_format';
import { stepsFromToolCalls } from './transcript';
import type { loadRoundSteps } from './register_memory';
import {
  createLlmProposeMemoryExtractions,
  createLlmProposeMemoryLabels,
  createLlmSynthesizeMemoryGroup,
  optimizeMemory,
  type MemoryOptimizeSummary,
} from './optimize';
import { createMemoryPageStore } from './page_store';
export const runMemoryOptimize = async ({
  request,
  agentId,
  userMessage,
  assistantMessage,
  toolCalls,
  conversationId,
  roundId,
  roundIndex,
  recalledIds,
  esClient,
  spaceId,
  signal,
  logger,
  requestedConnectorId,
  roundConnectorId,
  createModel,
  loadRound,
}: {
  request: KibanaRequest;
  agentId?: string;
  userMessage: string;
  assistantMessage: string;
  toolCalls: InvestigationToolCall[];
  conversationId?: string;
  roundId?: string;
  roundIndex?: number;
  recalledIds: string[];
  esClient: ElasticsearchClient;
  spaceId: string;
  interactionId: string;
  signal?: AbortSignal;
  logger: Logger;
  createModel: () => Promise<ScopedModel | undefined>;
  loadRound: (
    options: Omit<Parameters<typeof loadRoundSteps>[0], 'agentBuilder'>
  ) => ReturnType<typeof loadRoundSteps>;
  requestedConnectorId?: string;
  roundConnectorId?: string;
}): Promise<MemoryOptimizeSummary | undefined> => {
  logger.debug(
    `Memory optimize wiring space=${spaceId} agent=${agentId} ` +
      `connector=${requestedConnectorId ?? '(none)'} round=${roundConnectorId ?? '(none)'} ` +
      `recalledIds=${recalledIds.length} toolCalls=${toolCalls.length} userChars=${userMessage.length} ` +
      `assistantChars=${assistantMessage.length} user=${JSON.stringify(previewText(userMessage))}`
  );

  const model = await createModel();
  if (!model) {
    return undefined;
  }

  const investigation =
    (await loadRound({
      request,
      conversationId,
      roundId,
      roundIndex,
      logger,
      signal,
    })) ?? stepsFromToolCalls(toolCalls);

  const store = createMemoryPageStore({ esClient, logger, spaceId, signal });
  return optimizeMemory({
    store,
    recalledIds,
    proposeLabels: createLlmProposeMemoryLabels({ inferenceClient: model.inferenceClient, signal }),
    proposeExtractions: createLlmProposeMemoryExtractions({
      inferenceClient: model.inferenceClient,
      signal,
    }),
    synthesizeMemoryGroup: createLlmSynthesizeMemoryGroup({
      inferenceClient: model.inferenceClient,
      signal,
      logger,
    }),
    userMessage,
    assistantMessage,
    toolCalls,
    investigation,
    agentId,
    conversationId,
    logger,
    signal,
  });
};

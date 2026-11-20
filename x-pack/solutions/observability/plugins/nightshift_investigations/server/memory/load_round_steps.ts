/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest, Logger } from '@kbn/core/server';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import { loadInvestigationRound } from '../investigation_round/round_loader';
import { stepsFromRound, type TranscriptStep } from './transcript';
export const loadRoundSteps = async ({
  agentBuilder,
  request,
  conversationId,
  roundId,
  roundIndex,
  logger,
  signal,
  retryDelaysMs,
  getConversationClient,
}: {
  agentBuilder: AgentBuilderPluginStart | undefined;
  request: KibanaRequest;
  conversationId?: string;
  roundId?: string;
  roundIndex?: number;
  logger: Logger;
  signal?: AbortSignal;
  retryDelaysMs?: readonly number[];
  getConversationClient?: Parameters<typeof loadInvestigationRound>[0]['getConversationClient'];
}): Promise<TranscriptStep[] | undefined> => {
  const loaded = await loadInvestigationRound({
    agentBuilder,
    request,
    conversationId,
    roundId,
    roundIndex,
    logger,
    signal,
    retryDelaysMs,
    getConversationClient,
  });
  return loaded.source === 'persisted_round'
    ? stepsFromRound(loaded.rawSteps as Parameters<typeof stepsFromRound>[0])
    : undefined;
};

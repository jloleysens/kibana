/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, KibanaRequest, Logger } from '@kbn/core/server';
import type { ScopedModel } from '@kbn/agent-builder-server';
import type { InvestigationToolCall } from '../decision_trees/accessed_trees';
import { SANDBOX_TOOL_IDS } from '../agents/investigation/tool_ids';
import { usesKnowledge } from '../agents/agent_policy';
import type { loadInvestigationRound } from '../investigation_round/round_loader';
import type { CortexTelemetry } from '../telemetry/cortex_telemetry';
import { createLlmProposeCortexEdits, optimizeCortex } from './optimize';
import { createCortexPageStore } from './page_store';
const MIN_OPTIMIZE_TOOL_CALLS = 3;
const OPTIMIZER_TOOL_IDS: ReadonlySet<string> = new Set(SANDBOX_TOOL_IDS);
export const runCortexOptimize = async ({
  request,
  agentId,
  userMessage,
  assistantMessage,
  toolCalls,
  esClient,
  spaceId,
  signal,
  conversationId,
  roundId,
  roundIndex,
  logger,
  createModel,
  loadRound,
  telemetry,
}: {
  request: KibanaRequest;
  agentId?: string;
  userMessage: string;
  assistantMessage: string;
  toolCalls: InvestigationToolCall[];
  esClient: ElasticsearchClient;
  spaceId: string;
  interactionId: string;
  requestedConnectorId?: string;
  roundConnectorId?: string;
  signal?: AbortSignal;
  conversationId?: string;
  roundId?: string;
  roundIndex?: number;
  logger: Logger;
  createModel: () => Promise<ScopedModel | undefined>;
  loadRound: (
    options: Omit<Parameters<typeof loadInvestigationRound>[0], 'agentBuilder'>
  ) => ReturnType<typeof loadInvestigationRound>;
  telemetry: CortexTelemetry;
}): Promise<void> => {
  // Only the Nightshift knowledge agents write to Cortex: their post-execution hook runs this
  // workflow, and other agents' rounds must not edit the wiki. An unidentified caller is refused
  // rather than trusted — the optimize workflow has a manual trigger, so it can be run without an
  // agent id.
  if (!usesKnowledge(agentId)) {
    logger.info(
      'Cortex optimizer skipped — round was not produced by a Nightshift knowledge agent'
    );
    return;
  }

  const loadedRound = await loadRound({
    request,
    conversationId,
    roundId,
    roundIndex,
    fallbackToolCalls: toolCalls,
    logger,
    signal,
  });

  const sandboxToolCalls = loadedRound.toolCalls.filter(
    ({ tool_id: toolId }) => toolId !== undefined && OPTIMIZER_TOOL_IDS.has(toolId)
  );
  if (sandboxToolCalls.length < MIN_OPTIMIZE_TOOL_CALLS) {
    logger.debug(
      `Cortex optimizer skipped — round made ${sandboxToolCalls.length} sandbox tool calls, below ${MIN_OPTIMIZE_TOOL_CALLS}`
    );
    return;
  }

  const model = await createModel();
  if (!model) {
    return;
  }

  const store = createCortexPageStore({ esClient, logger, spaceId, signal });
  await optimizeCortex({
    store,
    proposeEdits: createLlmProposeCortexEdits({ inferenceClient: model.inferenceClient }),
    userMessage,
    assistantMessage,
    toolCalls: sandboxToolCalls,
    telemetry,
    logger,
  });
};

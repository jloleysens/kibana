/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreStart, ElasticsearchClient, KibanaRequest, Logger } from '@kbn/core/server';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import type { ContextEnginePluginSetup } from '@kbn/context-engine-plugin/server';
import type { InferenceServerStart } from '@kbn/inference-plugin/server';
import type { SandboxSession } from '@kbn/sandbox-plugin/server';
import { i18n } from '@kbn/i18n';
import { runMemoryOptimize as runMemoryOptimizeNative } from './run_optimize';
import { MEMORY_AI_INDEX_ID, MEMORY_INDEX } from '../../common/memory';
import {
  createInvestigationMemoryTelemetry,
  createOptimizeModel,
} from '../lib/create_optimize_model';
import type { InvestigationToolCall } from '../decision_trees/accessed_trees';
import { loadRoundSteps } from './load_round_steps';
export { loadRoundSteps } from './load_round_steps';
import type { MaterializeMemoryResult } from './materialize';
import { hydrateMemoryWorkspaceWithSessionState } from './hydrate_workspace';
export { hydrateMemoryWorkspaceWithSessionState } from './hydrate_workspace';
import type { MemoryOptimizeSummary } from './optimize';
import { createMemoryPageStore, type MemoryPageStore } from './page_store';

/** Registers the AI index so Context Engine manages it; the backing index is created on first write. */
export const registerMemoryAiIndex = (
  contextEngine: ContextEnginePluginSetup | undefined,
  logger: Logger
): void => {
  if (!contextEngine) {
    logger.debug(
      'contextEngine is not available — Semantic Memory AI index will not be registered'
    );
    return;
  }

  contextEngine.registerAiIndex(MEMORY_AI_INDEX_ID, {
    description: i18n.translate('xpack.nightshiftInvestigations.memory.aiIndexDescription', {
      defaultMessage:
        'Nightshift Semantic Memory — durable lessons the investigator recalls before a run, ranked by usefulness.',
    }),
    dest: { type: 'index', value: MEMORY_INDEX },
    automations: [],
    sources: [],
    traces: [],
  });
};

export const createMemoryStore = ({
  esClient,
  logger,
  spaceId,
  signal,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
  spaceId: string;
  signal?: AbortSignal;
}): MemoryPageStore => {
  return createMemoryPageStore({ esClient, logger, spaceId, signal });
};

export const hydrateMemoryWorkspace = (options: {
  session: SandboxSession;
  esClient: ElasticsearchClient;
  spaceId: string;
  agentId: string;
  query?: string;
  signal?: AbortSignal;
  logger: Logger;
}): Promise<MaterializeMemoryResult> =>
  hydrateMemoryWorkspaceWithSessionState({ ...options, getIsReset: () => options.session.isReset });

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
  getAgentBuilder,
  getInference,
  getSavedObjects,
  getUiSettings,
  logger,
  requestedConnectorId,
  roundConnectorId,
  interactionId,
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
  signal?: AbortSignal;
  getAgentBuilder: () => AgentBuilderPluginStart | undefined;
  getInference: () => InferenceServerStart | undefined;
  getSavedObjects: () => CoreStart['savedObjects'] | undefined;
  getUiSettings: () => CoreStart['uiSettings'] | undefined;
  logger: Logger;
  requestedConnectorId?: string;
  roundConnectorId?: string;
  interactionId: string;
}): Promise<MemoryOptimizeSummary | undefined> =>
  runMemoryOptimizeNative({
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
    interactionId,
    createModel: () =>
      createOptimizeModel({
        request,
        requestedConnectorId,
        roundConnectorId,
        agentBuilder: getAgentBuilder(),
        inference: getInference(),
        savedObjects: getSavedObjects(),
        uiSettings: getUiSettings(),
        telemetryMetadata: createInvestigationMemoryTelemetry(interactionId),
        logger,
      }),
    loadRound: (options) => loadRoundSteps({ ...options, agentBuilder: getAgentBuilder() }),
  });

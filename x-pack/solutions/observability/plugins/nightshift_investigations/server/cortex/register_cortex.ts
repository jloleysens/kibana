/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  AnalyticsServiceSetup,
  CoreStart,
  ElasticsearchClient,
  KibanaRequest,
  Logger,
} from '@kbn/core/server';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import type { InferenceServerStart } from '@kbn/inference-plugin/server';
import type { ContextEnginePluginSetup } from '@kbn/context-engine-plugin/server';
import { i18n } from '@kbn/i18n';
import type { SandboxSession } from '@kbn/sandbox-plugin/server';
import { runCortexOptimize as runCortexOptimizeNative } from './run_optimize';
import {
  createInvestigationMemoryTelemetry,
  createOptimizeModel,
} from '../lib/create_optimize_model';
import { CORTEX_AI_INDEX_DEST, CORTEX_AI_INDEX_ID } from '../../common/cortex';
import type { InvestigationToolCall } from '../decision_trees/accessed_trees';
import { loadInvestigationRound } from '../investigation_round';
import { createCortexTelemetry } from '../telemetry';
import { hydrateCortexWorkspaceWithTelemetry } from './hydrate_workspace';
export { hydrateCortexWorkspaceWithTelemetry } from './hydrate_workspace';
import { createCortexPageStore, type CortexPageStore } from './page_store';

export const createCortexStore = ({
  esClient,
  logger,
  spaceId,
  signal,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
  spaceId: string;
  signal?: AbortSignal;
}): CortexPageStore => createCortexPageStore({ esClient, logger, spaceId, signal });

export const registerCortexAiIndex = (
  contextEngine: ContextEnginePluginSetup | undefined,
  logger: Logger
): void => {
  if (!contextEngine) {
    logger.debug('contextEngine is not available — Cortex AI index will not be registered');
    return;
  }

  contextEngine.registerAiIndex(CORTEX_AI_INDEX_ID, {
    description: i18n.translate('xpack.nightshiftInvestigations.cortex.aiIndexDescription', {
      defaultMessage:
        'Nightshift Cortex wiki pages — durable, cross-linked knowledge the investigator reads before each run.',
    }),
    dest: { type: 'index', value: CORTEX_AI_INDEX_DEST },
    automations: [],
    sources: [],
    traces: [],
  });
};

export const hydrateCortexWorkspace = (options: {
  session: SandboxSession;
  esClient: ElasticsearchClient;
  spaceId: string;
  signal?: AbortSignal;
  analytics: AnalyticsServiceSetup;
  conversationId?: string;
  logger: Logger;
}): Promise<void> =>
  hydrateCortexWorkspaceWithTelemetry({
    ...options,
    telemetry: createCortexTelemetry(options),
  });

export const runCortexOptimize = async ({
  request,
  agentId,
  userMessage,
  assistantMessage,
  toolCalls,
  esClient,
  spaceId,
  interactionId,
  signal,
  getAgentBuilder,
  analytics,
  conversationId,
  roundId,
  roundIndex,
  requestedConnectorId,
  roundConnectorId,
  getInference,
  getSavedObjects,
  getUiSettings,
  logger,
}: {
  request: KibanaRequest;
  agentId?: string;
  userMessage: string;
  assistantMessage: string;
  toolCalls: InvestigationToolCall[];
  esClient: ElasticsearchClient;
  spaceId: string;
  interactionId: string;
  signal?: AbortSignal;
  getAgentBuilder: () => AgentBuilderPluginStart | undefined;
  analytics: AnalyticsServiceSetup;
  conversationId?: string;
  roundId?: string;
  roundIndex?: number;
  requestedConnectorId?: string;
  roundConnectorId?: string;
  getInference: () => InferenceServerStart | undefined;
  getSavedObjects: () => CoreStart['savedObjects'] | undefined;
  getUiSettings: () => CoreStart['uiSettings'] | undefined;
  logger: Logger;
}): Promise<void> =>
  runCortexOptimizeNative({
    request,
    agentId,
    userMessage,
    assistantMessage,
    toolCalls,
    esClient,
    spaceId,
    interactionId,
    signal,
    conversationId,
    roundId,
    roundIndex,
    requestedConnectorId,
    roundConnectorId,
    logger,
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
    loadRound: (options) => loadInvestigationRound({ ...options, agentBuilder: getAgentBuilder() }),
    telemetry: createCortexTelemetry({ analytics, conversationId, roundId, logger }),
  });

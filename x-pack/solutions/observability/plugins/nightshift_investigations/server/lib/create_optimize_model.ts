/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreStart, KibanaRequest, Logger } from '@kbn/core/server';
import type { AgentBuilderPluginStart, ScopedModel } from '@kbn/agent-builder-server';
import type { ConnectorTelemetryMetadata } from '@kbn/inference-common';
import type { InferenceServerStart } from '@kbn/inference-plugin/server';
import { resolveNightshiftModelForRequest } from '@kbn/nightshift-ai';
import { NightshiftModelBlockedError } from '@kbn/significant-events-schema';
import {
  NIGHTSHIFT_INVESTIGATION_MEMORY_USAGE_ID,
  NIGHTSHIFT_USAGE_PARENT_ID,
  NIGHTSHIFT_USAGE_PRODUCT_FEATURE,
  NIGHTSHIFT_USAGE_PRODUCT_SOLUTION,
} from '@kbn/nightshift-shared';
import { loadOptimizeModel } from './load_optimize_model';

/** Attributes Cortex and Semantic Memory optimize LLM calls to Nightshift investigation memory spend. */
export const createInvestigationMemoryTelemetry = (
  interactionId: string
): ConnectorTelemetryMetadata => ({
  pluginId: NIGHTSHIFT_INVESTIGATION_MEMORY_USAGE_ID,
  aggregateBy: NIGHTSHIFT_USAGE_PARENT_ID,
  productSolution: NIGHTSHIFT_USAGE_PRODUCT_SOLUTION,
  productFeature: NIGHTSHIFT_USAGE_PRODUCT_FEATURE,
  interactionId,
});

/**
 * Picks the optimize model with the Nightshift resolver (strict override, then the round's
 * model, then the Nightshift default), then loads it through Agent Builder's model provider.
 * Model problems throw so the optimize step fails visibly; only missing plugins skip.
 */
export const createOptimizeModel = async ({
  request,
  requestedConnectorId,
  roundConnectorId,
  agentBuilder,
  inference,
  savedObjects,
  uiSettings,
  telemetryMetadata,
  logger,
}: {
  request: KibanaRequest;
  requestedConnectorId?: string;
  roundConnectorId?: string;
  agentBuilder: AgentBuilderPluginStart | undefined;
  inference: InferenceServerStart | undefined;
  savedObjects: CoreStart['savedObjects'] | undefined;
  uiSettings: CoreStart['uiSettings'] | undefined;
  telemetryMetadata?: ConnectorTelemetryMetadata;
  logger: Logger;
}): Promise<ScopedModel | undefined> => {
  const connectorId = await resolveOptimizeConnector({
    request,
    requestedConnectorId,
    roundConnectorId,
    agentBuilder,
    inference,
    savedObjects,
    uiSettings,
    logger,
  });
  if (!connectorId || !agentBuilder) return undefined;

  const modelProvider = agentBuilder.runtime.createModelProvider({
    request,
    defaultConnectorId: connectorId,
    ...(telemetryMetadata ? { telemetryMetadata } : {}),
  });

  return loadOptimizeModel(modelProvider, connectorId, logger);
};

/** Resolves the original optimizer model policy without constructing an inference client. */
export const resolveOptimizeConnector = async ({
  request,
  requestedConnectorId,
  roundConnectorId,
  agentBuilder,
  inference,
  savedObjects,
  uiSettings,
  logger,
}: Omit<Parameters<typeof createOptimizeModel>[0], 'telemetryMetadata'>): Promise<
  string | undefined
> => {
  if (!agentBuilder || !inference || !savedObjects || !uiSettings) {
    logger.info('Optimize skipped — Agent Builder or model resolution unavailable');
    return undefined;
  }

  let connectorId: string;
  try {
    connectorId = await resolveNightshiftModelForRequest({
      request,
      inference,
      savedObjects,
      uiSettings,
      step: 'investigation',
      requestedId: requestedConnectorId,
      roundConnectorId,
      onFallback: (reason) =>
        logger.warn(`Optimize round model is unavailable, using the default: ${reason.message}`),
    });
  } catch (error) {
    if (error instanceof NightshiftModelBlockedError) {
      logger.error(error);
    }
    throw error;
  }

  return connectorId;
};

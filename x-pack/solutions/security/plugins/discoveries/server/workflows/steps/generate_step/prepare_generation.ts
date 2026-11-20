/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreStart, KibanaRequest, Logger } from '@kbn/core/server';
import type { DiscoveriesPluginStartDeps } from '../../../types';
import { asNonEmpty } from '../../../lib/non_empty_string';
import { resolveConnectorDetails } from '../../helpers/resolve_connector_details';
import { invokeGenerationGraph } from './helpers/invoke_generation_graph';
import type { GenerateContext, PreparedGeneration } from './generate_handler';

export interface GenerationDependencies {
  connectorTimeout: number;
  getStartServices(): Promise<{ coreStart: CoreStart; pluginsStart: DiscoveriesPluginStartDeps }>;
  langSmithApiKey?: string;
  langSmithProject?: string;
  logger: Logger;
}
export const prepareGeneration = async (
  {
    apiConfig,
    request,
    executionUuid,
    abortSignal,
  }: {
    apiConfig: GenerateContext['input']['api_config'];
    request: KibanaRequest;
    executionUuid: string;
    abortSignal?: AbortSignal;
  },
  {
    connectorTimeout,
    getStartServices,
    langSmithApiKey,
    langSmithProject,
    logger,
  }: GenerationDependencies
): Promise<PreparedGeneration> => {
  const { coreStart, pluginsStart } = await getStartServices();

  const actionsClient = await pluginsStart.actions.getActionsClientWithRequest(request);
  const savedObjectsClient = coreStart.savedObjects.getScopedClient(request);
  const esClient = coreStart.elasticsearch.client.asScoped(request).asCurrentUser;
  const inferenceClient = pluginsStart.inference?.getClient({ request });

  // action_type_id arrives as '' from the UI for EIS connectors; asNonEmpty
  // converts it to undefined so resolveConnectorDetails performs a lookup
  // instead of short-circuiting with an empty value:
  const { actionTypeId: resolvedActionTypeId } = await resolveConnectorDetails({
    actionsClient,
    actionTypeId: asNonEmpty(apiConfig.action_type_id),
    connectorId: apiConfig.connector_id,
    inference: pluginsStart.inference,
    logger,
    request,
  });

  const resolvedApiConfig = {
    action_type_id: resolvedActionTypeId,
    connector_id: apiConfig.connector_id,
    ...(apiConfig.model != null ? { model: apiConfig.model } : {}),
  };

  return {
    executionUuid,
    invoke: async (input) => {
      return invokeGenerationGraph({
        abortSignal,
        actionsClient,
        additionalContext: input.additionalContext,
        apiConfig: resolvedApiConfig,
        connectorTimeout,
        esClient,
        inferenceClient,
        langSmithApiKey,
        langSmithProject,
        logger,
        replacements: input.replacements,
        savedObjectsClient,
        size: input.size,
        sourceAlerts: input.sourceAlerts,
      });
    },
  };
};

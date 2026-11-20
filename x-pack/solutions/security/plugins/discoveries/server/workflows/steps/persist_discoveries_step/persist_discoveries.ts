/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreStart, KibanaRequest, Logger } from '@kbn/core/server';
import type { IRuleDataClient } from '@kbn/rule-registry-plugin/server';
import { createTracedLogger } from '@kbn/discoveries/impl/lib/create_traced_logger';
import type { DiscoveriesPluginStartDeps } from '../../../types';
import { asNonEmpty } from '../../../lib/non_empty_string';
import { resolveConnectorDetails } from '../../helpers/resolve_connector_details';
import { validateAttackDiscoveries } from '../../../routes/post/validate/helpers/validate_attack_discoveries';
import { authenticateAndGetSpace } from '../default_validation_step/helpers/authenticate_and_get_space';
import type { PersistDiscoveriesContext } from './persist_discoveries_handler';
export interface PersistDiscoveriesDependencies {
  adhocAttackDiscoveryDataClient: IRuleDataClient;
  getStartServices(): Promise<{ coreStart: CoreStart; pluginsStart: DiscoveriesPluginStartDeps }>;
  logger: Logger;
}
export const persistDiscoveries = async (
  input: PersistDiscoveriesContext['input'],
  request: KibanaRequest,
  { adhocAttackDiscoveryDataClient, getStartServices, logger }: PersistDiscoveriesDependencies
) => {
  const {
    alerts_context_count: alertsContextCount,
    anonymized_alerts: anonymizedAlerts,
    api_config: apiConfig,
    attack_discoveries: attackDiscoveries,
    connector_name: connectorName,
    enable_field_rendering: enableFieldRendering = true,
    generation_source: generationSource,
    generation_uuid: generationUuid,
    replacements,
    with_replacements: withReplacements = false,
  } = input;

  const tracedLogger = createTracedLogger(logger, generationUuid);
  const { coreStart, pluginsStart } = await getStartServices();

  const { authenticatedUser, esClient, spaceId } = await authenticateAndGetSpace({
    coreStart,
    pluginsStart,
    request,
  });

  const connectorId = apiConfig.connector_id;

  if (!connectorId) {
    throw new Error('Missing connector_id in api_config');
  }

  if (!spaceId) {
    throw new Error('Failed to resolve space id');
  }

  const actionsClient = await pluginsStart.actions.getActionsClientWithRequest(request);

  // connectorName may be '' from upstream workflow steps; asNonEmpty converts
  // it to undefined so resolveConnectorDetails looks up the real name:
  const { connectorName: resolvedConnectorName } = await resolveConnectorDetails({
    actionsClient,
    connectorId,
    connectorName: asNonEmpty(connectorName),
    inference: pluginsStart.inference,
    logger,
    request,
  });

  return validateAttackDiscoveries({
    adhocAttackDiscoveryDataClient,
    authenticatedUser,
    esClient,
    generationSource,
    logger: tracedLogger,
    spaceId,
    validateRequestBody: {
      alerts_context_count: alertsContextCount,
      anonymized_alerts: anonymizedAlerts,
      api_config: apiConfig,
      attack_discoveries: attackDiscoveries,
      connector_name: resolvedConnectorName,
      enable_field_rendering: enableFieldRendering,
      generation_uuid: generationUuid,
      replacements,
      with_replacements: withReplacements,
    },
  });
};

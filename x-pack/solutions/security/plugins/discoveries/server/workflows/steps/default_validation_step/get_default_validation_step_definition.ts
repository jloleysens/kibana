/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import type { Logger } from '@kbn/core/server';
import type { CoreStart } from '@kbn/core/server';

import type { DiscoveriesPluginStartDeps } from '../../../types';
import { asNonEmpty } from '../../../lib/non_empty_string';
import { resolveConnectorDetails } from '../../helpers/resolve_connector_details';
import { DefaultValidationStepCommonDefinition } from '../../../../common/step_types/default_validation_step';
import { authenticateAndGetSpace } from './helpers/authenticate_and_get_space';

import { createDefaultValidationHandler } from './default_validation_handler';
export { createDefaultValidationHandler } from './default_validation_handler';

/** Creates the original validation definition using request-scoped authorization and connector policy. */
export const getDefaultValidationStepDefinition = ({
  getStartServices,
  logger,
}: {
  getStartServices: () => Promise<{
    coreStart: CoreStart;
    pluginsStart: DiscoveriesPluginStartDeps;
  }>;
  logger: Logger;
}) =>
  createServerStepDefinition({
    ...DefaultValidationStepCommonDefinition,
    handler: createDefaultValidationHandler({
      logger,
      prepare: async (context) => {
        const { coreStart, pluginsStart } = await getStartServices();
        const request = context.contextManager.getFakeRequest();
        const { esClient, spaceId } = await authenticateAndGetSpace({
          coreStart,
          pluginsStart,
          request,
        });
        const { api_config: apiConfig, connector_name: connectorName } = context.input;
        const connectorId = apiConfig.connector_id;
        if (!connectorId) throw new Error('Missing connector_id in api_config');
        const actionsClient = await pluginsStart.actions.getActionsClientWithRequest(request);
        const { connectorName: resolvedConnectorName } = await resolveConnectorDetails({
          actionsClient,
          connectorId,
          connectorName: asNonEmpty(connectorName),
          inference: pluginsStart.inference,
          logger,
          request,
        });
        return { esClient, spaceId, resolvedConnectorName };
      },
    }),
  });

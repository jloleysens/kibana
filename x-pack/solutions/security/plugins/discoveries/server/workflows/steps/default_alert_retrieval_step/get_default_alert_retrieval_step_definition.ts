/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import type { CoreStart, Logger } from '@kbn/core/server';
import { DefaultAlertRetrievalStepCommonDefinition } from '../../../../common/step_types/default_alert_retrieval_step';
import type { DiscoveriesPluginStartDeps } from '../../../types';
import { resolveConnectorDetails } from '../../helpers/resolve_connector_details';

import { createDefaultAlertRetrievalHandler } from './default_alert_retrieval_handler';
export { createDefaultAlertRetrievalHandler } from './default_alert_retrieval_handler';

/** Creates the original request-scoped retrieval definition. */
export const getDefaultAlertRetrievalStepDefinition = ({
  getEventLogIndex: _getEventLogIndex,
  getEventLogger: _getEventLogger,
  getStartServices,
  logger,
}: {
  getEventLogIndex: () => Promise<string>;
  getEventLogger: () => Promise<unknown>;
  getStartServices: () => Promise<{
    coreStart: CoreStart;
    pluginsStart: DiscoveriesPluginStartDeps;
  }>;
  logger: Logger;
}) =>
  createServerStepDefinition({
    ...DefaultAlertRetrievalStepCommonDefinition,
    handler: createDefaultAlertRetrievalHandler({
      getSpaceId: (context) => context.contextManager.getContext().workflow.spaceId,
      prepare: async (context) => {
        const { coreStart, pluginsStart } = await getStartServices();
        const request = context.contextManager.getFakeRequest();
        const actionsClient = await pluginsStart.actions.getActionsClientWithRequest(request);
        const esClient = coreStart.elasticsearch.client.asScoped(request).asCurrentUser;
        return {
          esClient,
          resolveConnector: (connectorId) =>
            resolveConnectorDetails({
              actionsClient,
              connectorId,
              inference: pluginsStart.inference,
              logger,
              request,
            }),
        };
      },
    }),
  });

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { Replacements } from '@kbn/elastic-assistant-common';
import { getAnonymizedAlerts } from '@kbn/discoveries/impl/attack_discovery/graphs/default_attack_discovery_graph/nodes/retriever/helpers/get_anonymized_alerts';
import type { DefaultAlertRetrievalInputSchema } from '../../../../common/step_types/default_alert_retrieval_step';
import { asNonEmpty } from '../../../lib/non_empty_string';
import { fetchAnonymizationFields } from './helpers/fetch_anonymization_fields';
import {
  ensureRequiredAnonymizationFields,
  getAnonymizedAlertsFromEsql,
} from './helpers/transform_alerts';

export type DefaultAlertRetrievalContext = StepHandlerContext<
  typeof DefaultAlertRetrievalInputSchema
>;
export interface DefaultAlertRetrievalDependencies {
  getSpaceId(context: DefaultAlertRetrievalContext): string | Promise<string>;
  prepare(context: DefaultAlertRetrievalContext): Promise<{
    esClient: ElasticsearchClient;
    resolveConnector(connectorId: string): Promise<{ connectorName: string }>;
  }>;
}
/** Runs the original alert retrieval, anonymization and output algorithm. */
export const createDefaultAlertRetrievalHandler =
  ({ getSpaceId, prepare }: DefaultAlertRetrievalDependencies) =>
  async (context: DefaultAlertRetrievalContext) => {
    let spaceId: string | undefined;

    try {
      spaceId = await getSpaceId(context);

      const {
        alerts_index_pattern: alertsIndexPattern,
        anonymization_fields: anonymizationFields,
        api_config: apiConfig,
        end,
        esql_query: esqlQuery,
        filter,
        replacements: inputReplacements = {},
        size,
        start,
      } = context.input;

      context.logger.info(`Retrieving alerts from ${alertsIndexPattern} with size ${size}`);

      const { esClient, resolveConnector } = await prepare(context);

      const connectorId = apiConfig.connector_id;

      // Track replacements locally
      let localReplacements: Replacements = { ...inputReplacements };
      const onNewReplacements = (newReplacements: Replacements) => {
        localReplacements = { ...localReplacements, ...newReplacements };
      };

      const resolvedAnonymizationFields = ensureRequiredAnonymizationFields(
        anonymizationFields.length > 0
          ? anonymizationFields
          : await fetchAnonymizationFields({ esClient, spaceId })
      );

      // Retrieve and anonymize alerts
      const anonymizedAlertStrings =
        esqlQuery != null
          ? await getAnonymizedAlertsFromEsql({
              anonymizationFields: resolvedAnonymizationFields,
              esClient,
              esqlQuery,
              onNewReplacements,
              replacements: inputReplacements,
            })
          : await getAnonymizedAlerts({
              alertsIndexPattern,
              anonymizationFields: resolvedAnonymizationFields,
              end: end ?? undefined,
              esClient,
              filter: filter ?? undefined,
              onNewReplacements,
              replacements: inputReplacements,
              size,
              start: start ?? undefined,
            });

      context.logger.info(`Retrieved and anonymized ${anonymizedAlertStrings.length} alerts`);

      // Convert to Document format
      const anonymizedAlerts: Array<{
        id?: string;
        metadata: Record<string, never>;
        page_content: string;
      }> = anonymizedAlertStrings.map((alertString) => ({
        metadata: {} as Record<string, never>,
        page_content: alertString,
      }));

      // Retrieval needs no LLM connector; it is used only to label the
      // output with the optional `connector_name`. `resolveConnectorDetails`
      // throws when it cannot resolve, so without this guard a caller that
      // has no connector id yet fails here, after paying for the query.
      const resolvedConnectorId = asNonEmpty(connectorId);
      const connectorName =
        resolvedConnectorId != null
          ? (await resolveConnector(resolvedConnectorId)).connectorName
          : undefined;

      return {
        output: {
          alerts: anonymizedAlertStrings,
          alerts_context_count: anonymizedAlertStrings.length,
          anonymized_alerts: anonymizedAlerts,
          api_config: apiConfig,
          connector_name: connectorName,
          replacements: localReplacements,
        },
      };
    } catch (error) {
      context.logger.error('Failed to retrieve alerts', error);
      return {
        error: new Error(error instanceof Error ? error.message : 'Failed to retrieve alerts'),
      };
    }
  };

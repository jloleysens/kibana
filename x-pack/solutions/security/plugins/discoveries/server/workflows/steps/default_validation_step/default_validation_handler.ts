/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import { createTracedLogger } from '@kbn/discoveries/impl/lib/create_traced_logger';
import { getAlertsIndexForSpace } from '../../../lib/get_alerts_index_for_space';
import type { DefaultValidationInputSchema } from '../../../../common/step_types/default_validation_step';
import { filterAndValidateDiscoveries } from './helpers/filter_and_validate_discoveries';
import { handleValidationError } from './helpers/handle_validation_error';
import { transformDiscoveriesToOutputFormat } from './helpers/transform_discoveries_to_output_format';

export type DefaultValidationContext = StepHandlerContext<typeof DefaultValidationInputSchema>;
export interface DefaultValidationDependencies {
  logger: Logger;
  prepare(context: DefaultValidationContext): Promise<{
    esClient: ElasticsearchClient;
    spaceId: string;
    resolvedConnectorName: string;
  }>;
}

/** Runs the original hallucination filter and output transformation with explicit scoped dependencies. */
export const createDefaultValidationHandler =
  ({ logger, prepare }: DefaultValidationDependencies) =>
  async (context: DefaultValidationContext) => {
    try {
      const {
        alerts_index_pattern: alertsIndexPattern,
        api_config: apiConfig,
        attack_discoveries: attackDiscoveries,
        generation_uuid: generationUuid,
        replacements,
      } = context.input;

      const tracedLogger = createTracedLogger(logger, generationUuid);

      tracedLogger.info('[VALIDATE] Handler starting...');
      tracedLogger.debug(
        () => `[VALIDATE] Context input: ${JSON.stringify(context.input, null, 2)}`
      );

      const { esClient, spaceId, resolvedConnectorName } = await prepare(context);
      const effectiveAlertsIndexPattern = alertsIndexPattern ?? getAlertsIndexForSpace(spaceId);
      const connectorId = apiConfig.connector_id;

      const { filteredCount, filterReason, shouldValidate, validDiscoveries } =
        await filterAndValidateDiscoveries({
          alertsIndexPattern: effectiveAlertsIndexPattern,
          attackDiscoveries,
          contextLogger: context.logger,
          esClient,
          generationUuid,
          logger: tracedLogger,
        });

      tracedLogger.info(
        `[VALIDATE] Filter result: shouldValidate=${shouldValidate}, validDiscoveries=${
          validDiscoveries.length
        }, filteredCount=${filteredCount}, originalCount=${attackDiscoveries?.length ?? 0}`
      );

      if (!shouldValidate) {
        tracedLogger.warn(
          `[VALIDATE] No discoveries to validate after filtering. Original count: ${
            attackDiscoveries?.length ?? 0
          }`
        );

        return {
          output: {
            ...(filterReason != null ? { filter_reason: filterReason } : {}),
            filtered_count: filteredCount,
            validated_discoveries: [],
          },
        };
      }

      context.logger.info(
        `Validating ${validDiscoveries.length} attack discoveries (generation: ${generationUuid})`
      );

      const transformedDiscoveries = transformDiscoveriesToOutputFormat({
        attackDiscoveries: validDiscoveries,
        connectorId,
        connectorName: resolvedConnectorName,
        generationUuid,
        replacements,
      });

      return {
        output: {
          ...(filterReason != null ? { filter_reason: filterReason } : {}),
          filtered_count: filteredCount,
          validated_discoveries: transformedDiscoveries,
        },
      };
    } catch (error) {
      return handleValidationError({
        contextLogger: context.logger,
        error,
        logger,
      });
    }
  };

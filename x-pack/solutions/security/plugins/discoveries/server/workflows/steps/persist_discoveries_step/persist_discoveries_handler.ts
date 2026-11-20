/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import { createTracedLogger } from '@kbn/discoveries/impl/lib/create_traced_logger';
import type { PersistDiscoveriesInputSchema } from '../../../../common/step_types/persist_discoveries_step';
import type { persistDiscoveries } from './persist_discoveries';
export type PersistDiscoveriesContext = StepHandlerContext<typeof PersistDiscoveriesInputSchema>;
export const createPersistDiscoveriesHandler =
  ({
    logger,
    persist,
  }: {
    logger: Logger;
    persist(
      input: PersistDiscoveriesContext['input'],
      context: PersistDiscoveriesContext
    ): ReturnType<typeof persistDiscoveries>;
  }) =>
  async (context: PersistDiscoveriesContext) => {
    try {
      const {
        attack_discoveries: attackDiscoveries,
        generation_uuid: generationUuid,
        source,
      } = context.input;

      const tracedLogger = createTracedLogger(logger, generationUuid);

      tracedLogger.info('[PERSIST] Handler starting...');

      // Scheduled executions are persisted by the alerting-framework executor
      // (workflowExecutor) via alertsClient, which writes to the dedicated
      // scheduled alerts index. Writing here too would put scheduled
      // discoveries into the ad-hoc index, causing them to appear on the
      // main Attack Discovery page (which only queries the ad-hoc index).
      if (source === 'scheduled') {
        tracedLogger.info(
          '[PERSIST] Skipping ad-hoc persistence for scheduled execution — alertsClient handles persistence to the scheduled index'
        );

        return {
          output: {
            discoveries_to_persist: attackDiscoveries,
            duplicates_dropped_count: 0,
            persisted_discoveries: [],
          },
        };
      }

      if (attackDiscoveries.length === 0) {
        tracedLogger.info('[PERSIST] No discoveries to persist');

        return {
          output: {
            discoveries_to_persist: attackDiscoveries,
            duplicates_dropped_count: 0,
            persisted_discoveries: [],
          },
        };
      }

      context.logger.info(
        `Persisting ${attackDiscoveries.length} attack discoveries (generation: ${generationUuid})`
      );

      const result = await persist(context.input, context);

      tracedLogger.info(
        `[PERSIST] Successfully persisted ${
          result.validated_discoveries?.length ?? 0
        } discoveries (${result.duplicates_dropped_count} duplicates dropped)`
      );

      return {
        output: {
          discoveries_to_persist: attackDiscoveries,
          duplicates_dropped_count: result.duplicates_dropped_count,
          persisted_discoveries: result.validated_discoveries,
        },
      };
    } catch (error) {
      logger.debug(
        () => `[PERSIST] ERROR: ${error instanceof Error ? error.stack : String(error)}`
      );

      context.logger.error(
        'Failed to persist discoveries',
        error instanceof Error ? error : undefined
      );

      return {
        error: new Error(error instanceof Error ? error.message : 'Failed to persist discoveries'),
      };
    }
  };

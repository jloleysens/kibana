/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreStart, Logger } from '@kbn/core/server';
import type { InferenceServerStart } from '@kbn/inference-plugin/server';
import { NightshiftModelBlockedError } from '@kbn/significant-events-schema';
import { resolveNightshiftModelForRequest } from '@kbn/nightshift-ai';

import type { KibanaRequest } from '@kbn/core/server';
import type { ModelSelectionInput } from './model_selection_tokens';

export interface ModelResolutionDeps {
  getInference: () => InferenceServerStart | undefined;
  getSavedObjects: () => CoreStart['savedObjects'] | undefined;
  getUiSettings: () => CoreStart['uiSettings'] | undefined;
  logger: Logger;
}

export const createModelResolver =
  ({ getInference, getSavedObjects, getUiSettings, logger }: ModelResolutionDeps) =>
  async (request: KibanaRequest, input: ModelSelectionInput): Promise<string> => {
    const inference = getInference();
    const savedObjects = getSavedObjects();
    const uiSettings = getUiSettings();
    if (!inference || !savedObjects || !uiSettings) {
      throw new Error('Nightshift model resolution is unavailable');
    }

    try {
      const connectorId = await resolveNightshiftModelForRequest({
        request,
        inference,
        savedObjects,
        uiSettings,
        step: input.step,
        requestedId: input.connector_id,
        roundConnectorId: input.round_connector_id,
        onFallback: (reason) =>
          logger.warn(
            `Nightshift round model is unavailable, using the default: ${reason.message}`
          ),
      });

      return connectorId;
    } catch (error) {
      if (error instanceof NightshiftModelBlockedError) {
        logger.error(error);
      }
      throw error;
    }
  };

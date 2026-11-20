/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreStart, KibanaRequest, Logger } from '@kbn/core/server';
import type { InferenceServerStart } from '@kbn/inference-plugin/server';
import {
  MAX_ID_LENGTH,
  NightshiftModelBlockedError,
  type NightshiftModelStep,
} from '@kbn/significant-events-schema';
import { StepCategory } from '@kbn/workflows';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { z } from '@kbn/zod/v4';
import { resolveNightshiftModelForRequest } from '@kbn/nightshift-ai';
import { createResolveModelHandler } from './resolve_model_handler';

const significantEventsModelSteps = [
  'discovery',
  'kiExtraction',
  'kiQueryGeneration',
] as const satisfies readonly NightshiftModelStep[];

export const resolveModelStepDefinition = ({
  getInference,
  getSavedObjects,
  getUiSettings,
  logger,
}: {
  getInference: () => InferenceServerStart | undefined;
  getSavedObjects: () => CoreStart['savedObjects'] | undefined;
  getUiSettings: () => CoreStart['uiSettings'] | undefined;
  logger: Logger;
}) =>
  createServerStepDefinition({
    id: 'significantEvents.resolveModel',
    label: 'Resolve significant events model',
    category: StepCategory.Ai,
    description: 'Validates and resolves the model used by a significant events step.',
    inputSchema: z.object({
      step: z.enum(significantEventsModelSteps),
      connector_id: z.string().max(MAX_ID_LENGTH).optional(),
    }),
    outputSchema: z.object({
      connector_id: z.string().max(MAX_ID_LENGTH),
    }),
    handler: (context) =>
      createResolveModelHandler((input) =>
        resolveModelForStep(input, () => context.contextManager.getFakeRequest(), {
          getInference,
          getSavedObjects,
          getUiSettings,
          logger,
        })
      )(context),
  });

export interface ResolveModelDependencies {
  getInference: () => InferenceServerStart | undefined;
  getSavedObjects: () => CoreStart['savedObjects'] | undefined;
  getUiSettings: () => CoreStart['uiSettings'] | undefined;
  logger: Logger;
}
export interface ResolveModelInput {
  step: (typeof significantEventsModelSteps)[number];
  connector_id?: string;
}

export const resolveModelForStep = async (
  input: ResolveModelInput,
  getRequest: () => KibanaRequest,
  { getInference, getSavedObjects, getUiSettings, logger }: ResolveModelDependencies
): Promise<string> => {
  const inference = getInference();
  const savedObjects = getSavedObjects();
  const uiSettings = getUiSettings();
  if (!inference || !savedObjects || !uiSettings) {
    throw new Error('Significant events model resolution is unavailable');
  }

  try {
    const connectorId = await resolveNightshiftModelForRequest({
      request: getRequest(),
      inference,
      savedObjects,
      uiSettings,
      step: input.step,
      requestedId: input.connector_id,
    });

    return connectorId;
  } catch (error) {
    if (error instanceof NightshiftModelBlockedError) {
      logger.error(error);
    }
    throw error;
  }
};

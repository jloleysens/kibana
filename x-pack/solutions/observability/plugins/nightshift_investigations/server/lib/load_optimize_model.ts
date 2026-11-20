/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { ModelProvider, ScopedModel } from '@kbn/agent-builder-server';
export const loadOptimizeModel = async (
  modelProvider: ModelProvider,
  connectorId: string,
  logger: Logger
): Promise<ScopedModel> => {
  try {
    const model = await modelProvider.getDefaultModel();
    logger.debug(`Optimize connector=${model.connector.connectorId}`);
    return model;
  } catch (error) {
    logger.error(
      `Optimize model "${connectorId}" could not be loaded: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    throw error;
  }
};

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { CoreStart } from '@kbn/core/server';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server';

import { GenerateStepCommonDefinition } from '../../../../common/step_types/generate_step';
import type { DiscoveriesPluginStartDeps } from '../../../types';
import { prepareGeneration } from './prepare_generation';
import { createGenerateHandler } from './generate_handler';

/**
 * Server-side implementation of the generate step.
 * Generates Attack Discoveries from pre-retrieved alerts.
 */
export const getGenerateStepDefinition = ({
  connectorTimeout,
  getEventLogIndex: _getEventLogIndex,
  getEventLogger: _getEventLogger,
  getStartServices,
  langSmithApiKey,
  langSmithProject,
  logger,
}: {
  connectorTimeout: number;
  getEventLogIndex: () => Promise<string>;
  getEventLogger: () => Promise<unknown>;
  getStartServices: () => Promise<{
    coreStart: CoreStart;
    pluginsStart: DiscoveriesPluginStartDeps;
  }>;
  langSmithApiKey?: string;
  langSmithProject?: string;
  logger: Logger;
}) =>
  createServerStepDefinition({
    ...GenerateStepCommonDefinition,
    handler: createGenerateHandler(async (context) =>
      prepareGeneration(
        {
          apiConfig: context.input.api_config,
          request: context.contextManager.getFakeRequest(),
          executionUuid: context.contextManager.getContext().execution.id,
          abortSignal: context.abortSignal,
        },
        { connectorTimeout, getStartServices, langSmithApiKey, langSmithProject, logger }
      )
    ),
  });

export { createGenerateHandler } from './generate_handler';

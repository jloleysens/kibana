/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { PersistDiscoveriesStepCommonDefinition } from '../../../../common/step_types/persist_discoveries_step';
import { persistDiscoveries, type PersistDiscoveriesDependencies } from './persist_discoveries';
import { createPersistDiscoveriesHandler } from './persist_discoveries_handler';
export const getPersistDiscoveriesStepDefinition = (dependencies: PersistDiscoveriesDependencies) =>
  createServerStepDefinition({
    ...PersistDiscoveriesStepCommonDefinition,
    handler: createPersistDiscoveriesHandler({
      logger: dependencies.logger,
      persist: (input, context) =>
        persistDiscoveries(input, context.contextManager.getFakeRequest(), dependencies),
    }),
  });

export { createPersistDiscoveriesHandler } from './persist_discoveries_handler';

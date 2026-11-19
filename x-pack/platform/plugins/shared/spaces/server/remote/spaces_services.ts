/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { of } from 'rxjs';

import type { BuildFlavor } from '@kbn/config';
import type { KibanaRequest, Logger } from '@kbn/core/server';
import type { CPSServerStart } from '@kbn/cps/server';
import type { FeaturesPluginStart } from '@kbn/features-plugin/server';

import type { ConfigType } from '../config';
import { SpacesClientService } from '../spaces_client';
import type { SpacesClientServiceSetup, SpacesSavedObjectsService } from '../spaces_client';
import { SpacesService } from '../spaces_service';
import type { SpacesServiceStart } from '../spaces_service';

export interface WorkerSpacesDependencies {
  readonly savedObjects: SpacesSavedObjectsService;
  readonly config: ConfigType;
  readonly buildFlavor: BuildFlavor;
  readonly features: Pick<FeaturesPluginStart, 'getKibanaFeatures'>;
  readonly cps: Pick<CPSServerStart, 'createNpreClient'> | undefined;
  readonly logger: Logger;
  /** Installs the original security plugin's spaces repository factory and secure client wrapper. */
  readonly setupSecurity: (spacesClient: SpacesClientServiceSetup) => void;
  readonly assertRequest: (request: KibanaRequest) => void;
}

/** Builds the original spaces client/service with explicit dependencies and lease-local requests. */
export const createWorkerSpaces = ({
  savedObjects,
  config,
  buildFlavor,
  features,
  cps,
  logger,
  setupSecurity,
  assertRequest,
}: WorkerSpacesDependencies): SpacesServiceStart => {
  const clientService = new SpacesClientService((message) => logger.debug(message), buildFlavor);
  const setup = clientService.setup({ config$: of(config) });
  let repositoryConfigured = false;
  let wrapperConfigured = false;
  setupSecurity({
    setClientRepositoryFactory: (factory) => {
      setup.setClientRepositoryFactory(factory);
      repositoryConfigured = true;
    },
    registerClientWrapper: (wrapper) => {
      setup.registerClientWrapper(wrapper);
      wrapperConfigured = true;
    },
  });
  if (!repositoryConfigured || !wrapperConfigured) {
    throw new Error('Worker spaces require the security repository factory and client wrapper');
  }
  const clients = clientService.start({ savedObjects }, features, cps);
  return new SpacesService().start({
    spacesClientService: {
      createSpacesClient: (request) => {
        assertRequest(request);
        return clients.createSpacesClient(request);
      },
    },
  });
};

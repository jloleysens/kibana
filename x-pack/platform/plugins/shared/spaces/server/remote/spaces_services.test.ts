/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { httpServerMock } from '@kbn/core-http-server-mocks';
import { savedObjectsServiceMock } from '@kbn/core-saved-objects-server-mocks';
import { featuresPluginMock } from '@kbn/features-plugin/server/mocks';
import { loggerMock } from '@kbn/logging-mocks';

import type { WorkerSpacesDependencies } from './spaces_services';
import { createWorkerSpaces } from './spaces_services';
import { spacesConfig } from '../lib/__fixtures__';

const createDeps = (): WorkerSpacesDependencies => ({
  savedObjects: savedObjectsServiceMock.createStartContract(),
  config: spacesConfig,
  buildFlavor: 'traditional',
  features: featuresPluginMock.createStart(),
  cps: undefined,
  logger: loggerMock.create(),
  setupSecurity: jest.fn((setup) => {
    setup.setClientRepositoryFactory((request, savedObjects) =>
      savedObjects.createScopedRepository(request, ['space'])
    );
    setup.registerClientWrapper((_request, client) => client);
  }),
  assertRequest: jest.fn(),
});

describe('createWorkerSpaces', () => {
  it('creates the original spaces clients per request, after installing security hooks', () => {
    const deps = createDeps();
    const services = createWorkerSpaces(deps);
    const first = httpServerMock.createKibanaRequest({ spaceId: 'first' });
    const second = httpServerMock.createKibanaRequest({ spaceId: 'second' });
    expect(services.getSpaceId(first)).toBe('first');
    expect(services.getSpaceId(second)).toBe('second');
    expect(services.createSpacesClient(first)).not.toBe(services.createSpacesClient(second));
    expect(deps.setupSecurity).toHaveBeenCalledTimes(1);
    expect(deps.assertRequest).toHaveBeenNthCalledWith(1, first);
    expect(deps.assertRequest).toHaveBeenNthCalledWith(2, second);
    expect(deps.savedObjects.createScopedRepository).toHaveBeenNthCalledWith(1, first, ['space']);
    expect(deps.savedObjects.createScopedRepository).toHaveBeenNthCalledWith(2, second, ['space']);
  });

  it('rejects a missing security hook instead of using an unprotected spaces client', () => {
    const deps = createDeps();
    expect(() => createWorkerSpaces({ ...deps, setupSecurity: () => undefined })).toThrow(
      'security repository factory and client wrapper'
    );
    expect(() =>
      createWorkerSpaces({
        ...deps,
        setupSecurity: (setup) => setup.registerClientWrapper((_request, client) => client),
      })
    ).toThrow('security repository factory and client wrapper');
  });

  it('rejects closed requests before constructing a repository', () => {
    const deps = createDeps();
    const services = createWorkerSpaces({
      ...deps,
      assertRequest: () => {
        throw new Error('Closed scope');
      },
    });
    expect(() => services.createSpacesClient(httpServerMock.createKibanaRequest())).toThrow(
      'Closed scope'
    );
    expect(deps.savedObjects.createScopedRepository).not.toHaveBeenCalled();
  });
});

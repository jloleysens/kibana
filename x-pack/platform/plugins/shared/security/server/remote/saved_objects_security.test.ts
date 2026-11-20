/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core-elasticsearch-server-mocks';
import { httpServerMock } from '@kbn/core-http-server-mocks';
import { SavedObjectTypeRegistry } from '@kbn/core-saved-objects-base-server-internal';

import { createWorkerSavedObjectsSecurity } from './saved_objects_security';
import { licenseMock } from '../../common/licensing/index.mock';
import { auditServiceMock } from '../audit/mocks';

const setup = ({ allowed = true, allowRbac = true } = {}) => {
  const clusterClient = elasticsearchServiceMock.createClusterClient();
  const scoped = elasticsearchServiceMock.createScopedClusterClient();
  clusterClient.asScoped.mockReturnValue(scoped);
  scoped.asCurrentUser.security.hasPrivileges.mockImplementation(async (params) => ({
    username: 'run-user',
    has_all_requested: allowed,
    cluster: {},
    index: {},
    application: Object.fromEntries(
      (params?.application ?? []).map(({ application, resources, privileges }) => [
        application,
        Object.fromEntries(
          resources.map((resource) => [
            resource,
            Object.fromEntries(privileges.map((privilege) => [privilege, allowed])),
          ])
        ),
      ])
    ),
  }));
  const audit = auditServiceMock.create();
  const licenseFeatures = { ...licenseMock.create().getFeatures(), allowRbac };
  const active = new Set<ReturnType<typeof httpServerMock.createKibanaRequest>>();
  const assertRequest = jest.fn((request) => {
    if (!active.has(request)) throw new Error('Request outside active run scope');
  });
  const getCurrentUser = jest.fn(() => null);
  const extensions = createWorkerSavedObjectsSecurity({
    clusterClient,
    applicationName: 'kibana-test',
    licenseFeatures,
    audit,
    getCurrentUser,
    assertRequest,
    spaces: { namespaceToSpaceId: (namespace) => namespace ?? 'default' },
  });
  const typeRegistry = new SavedObjectTypeRegistry();
  typeRegistry.registerType({
    name: 'business',
    namespaceType: 'single',
    hidden: false,
    mappings: { properties: {} },
  });
  return {
    ...extensions,
    clusterClient,
    scoped,
    audit,
    active,
    assertRequest,
    getCurrentUser,
    typeRegistry,
  };
};

describe('createWorkerSavedObjectsSecurity', () => {
  it.each([true, false])(
    'uses original privilege enforcement for run request and space (allowed=%s)',
    async (allowed) => {
      const services = setup({ allowed });
      const request = httpServerMock.createKibanaRequest({
        headers: { authorization: 'ApiKey run-user' },
        spaceId: 'run-space',
      });
      services.active.add(request);
      const extension = services.security({ request, typeRegistry: services.typeRegistry });
      if (!extension) throw new Error('Expected RBAC extension');
      const pending = extension.authorizeCreate({
        namespace: 'run-space',
        object: {
          type: 'business',
          id: 'result',
          existingNamespaces: [],
          initialNamespaces: undefined,
          name: 'outcome',
        },
      });
      if (allowed) await expect(pending).resolves.toBeDefined();
      else await expect(pending).rejects.toThrow();
      expect(services.clusterClient.asScoped).toHaveBeenCalledWith(request);
      expect(services.scoped.asCurrentUser.security.hasPrivileges).toHaveBeenCalledWith(
        expect.objectContaining({
          application: [
            expect.objectContaining({ application: 'kibana-test', resources: ['space:run-space'] }),
          ],
        })
      );
      expect(services.audit.asScoped).toHaveBeenCalledWith(request);
      expect(services.getCurrentUser).toHaveBeenCalledWith(request);
    }
  );

  it('rejects closed/foreign requests before any internal repository or privilege use', () => {
    const services = setup();
    const request = httpServerMock.createKibanaRequest();
    expect(() => services.security({ request, typeRegistry: services.typeRegistry })).toThrow(
      'outside active run'
    );
    expect(services.clusterClient.asScoped).not.toHaveBeenCalled();
    services.active.add(request);
    expect(services.security({ request, typeRegistry: services.typeRegistry })).toBeDefined();
    services.active.delete(request);
    expect(() => services.security({ request, typeRegistry: services.typeRegistry })).toThrow(
      'outside active run'
    );
  });

  it('revalidates scope when an existing extension is used after the run ends', async () => {
    const services = setup();
    const request = httpServerMock.createKibanaRequest();
    services.active.add(request);
    const extension = services.security({ request, typeRegistry: services.typeRegistry });
    if (!extension) throw new Error('Expected RBAC extension');
    services.active.delete(request);
    await expect(
      extension.authorizeCreate({
        namespace: 'default',
        object: { type: 'business', id: 'result', existingNamespaces: [] },
      })
    ).rejects.toThrow('outside active run');
    expect(services.clusterClient.asScoped).not.toHaveBeenCalled();
  });

  it('preserves the original non-RBAC fallback, still enforcing the request scope', () => {
    const services = setup({ allowRbac: false });
    const request = httpServerMock.createKibanaRequest();
    services.active.add(request);
    expect(services.security({ request, typeRegistry: services.typeRegistry })).toBeUndefined();
    services.active.delete(request);
    expect(() => services.security({ request, typeRegistry: services.typeRegistry })).toThrow(
      'outside active run'
    );
  });
});

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IClusterClient, ISavedObjectTypeRegistry, KibanaRequest } from '@kbn/core/server';
import { Actions } from '@kbn/security-authorization-core';
import type { SecurityLicenseFeatures } from '@kbn/security-plugin-types-common';
import type { SpacesPluginSetup } from '@kbn/spaces-plugin/server';

import { checkPrivilegesFactory } from '../authorization/check_privileges';
import { checkSavedObjectsPrivilegesWithRequestFactory } from '../authorization/check_saved_objects_privileges';
import { authorizationModeFactory } from '../authorization/mode';
import { createSavedObjectsSecurityExtensions } from '../saved_objects/create_security_extensions';
import type {
  SavedObjectsSecurityDependencies,
  SavedObjectsSecurityExtensions,
} from '../saved_objects/create_security_extensions';
import { setupSpacesClient } from '../spaces/setup_spaces_client';

export interface WorkerSavedObjectsSecurityDependencies {
  readonly clusterClient: IClusterClient;
  readonly applicationName: string;
  readonly licenseFeatures: SecurityLicenseFeatures;
  readonly audit: SavedObjectsSecurityDependencies['audit'];
  readonly getCurrentUser: SavedObjectsSecurityDependencies['getCurrentUser'];
  readonly spaces: { namespaceToSpaceId: (namespace: string | undefined) => string };
  /** Fails if the request does not belong to the active lease, before internal repository access. */
  readonly assertRequest: (request: KibanaRequest) => void;
}

export interface WorkerSavedObjectsSecurityServices extends SavedObjectsSecurityExtensions {
  readonly setupSpacesClient: (
    spacesClient: SpacesPluginSetup['spacesClient'],
    getTypeRegistry: () => ISavedObjectTypeRegistry
  ) => void;
}

/** Reuses the plugin's privilege checks and SO extensions with lease-local identity and policy. */
export const createWorkerSavedObjectsSecurity = ({
  clusterClient,
  applicationName,
  licenseFeatures,
  audit,
  getCurrentUser,
  spaces,
  assertRequest,
}: WorkerSavedObjectsSecurityDependencies): WorkerSavedObjectsSecurityServices => {
  const actions = new Actions();
  const mode = authorizationModeFactory({ getFeatures: () => licenseFeatures });
  const privileges = checkPrivilegesFactory(actions, async () => clusterClient, applicationName);
  const checkSavedObjectsPrivilegesWithRequest = checkSavedObjectsPrivilegesWithRequestFactory(
    privileges.checkPrivilegesWithRequest,
    () => spaces
  );
  const scopedUser = (request: KibanaRequest) => {
    assertRequest(request);
    return getCurrentUser(request);
  };
  const authz: Parameters<typeof setupSpacesClient>[0]['authz'] = {
    actions,
    mode: {
      useRbacForRequest: (request) => {
        assertRequest(request);
        return mode.useRbacForRequest(request);
      },
    },
    checkPrivilegesWithRequest: (request) => {
      assertRequest(request);
      const check = privileges.checkPrivilegesWithRequest(request);
      return {
        atSpace: (...args) => {
          assertRequest(request);
          return check.atSpace(...args);
        },
        atSpaces: (...args) => {
          assertRequest(request);
          return check.atSpaces(...args);
        },
        globally: (...args) => {
          assertRequest(request);
          return check.globally(...args);
        },
      };
    },
    checkSavedObjectsPrivilegesWithRequest: (request) => {
      assertRequest(request);
      const check = checkSavedObjectsPrivilegesWithRequest(request);
      return (...args) => {
        assertRequest(request);
        return check(...args);
      };
    },
  };
  const extensions = createSavedObjectsSecurityExtensions({
    audit,
    getCurrentUser: scopedUser,
    authz,
  });
  return {
    ...extensions,
    setupSpacesClient: (spacesClient, getTypeRegistry) =>
      setupSpacesClient({
        audit,
        authz,
        spaces: { spacesClient },
        getCurrentUser: scopedUser,
        getTypeRegistry,
      }),
  };
};

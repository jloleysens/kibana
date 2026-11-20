/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AuthenticatedUser, KibanaRequest } from '@kbn/core/server';
import { SavedObjectsClient } from '@kbn/core-saved-objects-api-server-internal';
import type {
  SavedObjectsClientFactoryProvider,
  SavedObjectsSecurityExtensionFactory,
  SavedObjectsServiceSetup,
} from '@kbn/core-saved-objects-server';
import type {
  AuditServiceSetup,
  AuthorizationServiceSetup,
} from '@kbn/security-plugin-types-server';

import { getImportTransformsFactory } from './access_control_transforms';
import { SavedObjectsSecurityExtension } from './saved_objects_security_extension';

export interface SavedObjectsSecurityDependencies {
  readonly audit: AuditServiceSetup;
  readonly authz: Pick<
    AuthorizationServiceSetup,
    'mode' | 'actions' | 'checkSavedObjectsPrivilegesWithRequest'
  >;
  readonly getCurrentUser: (request: KibanaRequest) => AuthenticatedUser | null;
}

export interface SavedObjectsSecurityExtensions {
  readonly clientFactory: SavedObjectsClientFactoryProvider;
  readonly security: SavedObjectsSecurityExtensionFactory;
  readonly accessControlTransforms: Parameters<
    SavedObjectsServiceSetup['setAccessControlTransforms']
  >[0];
}

/** Builds the same saved object authorization extensions for Kibana and a lazy worker. */
export const createSavedObjectsSecurityExtensions = ({
  audit,
  authz,
  getCurrentUser,
}: SavedObjectsSecurityDependencies): SavedObjectsSecurityExtensions => ({
  // Preserve the scoped-ES fallback for deployments using third-party authentication without RBAC.
  clientFactory:
    (repositoryFactory) =>
    ({ request, includedHiddenTypes, extensions }) => {
      return new SavedObjectsClient(
        authz.mode.useRbacForRequest(request)
          ? repositoryFactory.createInternalRepository(
              includedHiddenTypes,
              extensions,
              request.serverTiming
            )
          : repositoryFactory.createScopedRepository(request, includedHiddenTypes, extensions)
      );
    },
  security: ({ request, typeRegistry }) => {
    return authz.mode.useRbacForRequest(request)
      ? new SavedObjectsSecurityExtension({
          actions: authz.actions,
          auditLogger: audit.asScoped(request),
          checkPrivileges: authz.checkSavedObjectsPrivilegesWithRequest(request),
          errors: SavedObjectsClient.errors,
          getCurrentUser: () => getCurrentUser(request),
          typeRegistry,
        })
      : undefined;
  },
  accessControlTransforms: { createImportTransforms: getImportTransformsFactory() },
});

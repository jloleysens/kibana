/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AuthenticatedUser, CoreSetup, KibanaRequest } from '@kbn/core/server';
import type { AuditServiceSetup } from '@kbn/security-plugin-types-server';

import { createSavedObjectsSecurityExtensions } from './create_security_extensions';
import type { AuthorizationServiceSetupInternal } from '../authorization';

export { SecurityAction } from './types';

interface SetupSavedObjectsParams {
  audit: AuditServiceSetup;
  authz: Pick<
    AuthorizationServiceSetupInternal,
    'mode' | 'actions' | 'checkSavedObjectsPrivilegesWithRequest'
  >;
  savedObjects: CoreSetup['savedObjects'];
  getCurrentUser: (request: KibanaRequest) => AuthenticatedUser | null;
}

export function setupSavedObjects({
  audit,
  authz,
  savedObjects,
  getCurrentUser,
}: SetupSavedObjectsParams) {
  const extensions = createSavedObjectsSecurityExtensions({ audit, authz, getCurrentUser });
  savedObjects.setClientFactoryProvider(extensions.clientFactory);
  savedObjects.setSecurityExtension(extensions.security);
  savedObjects.setAccessControlTransforms(extensions.accessControlTransforms);
}

export { SavedObjectsSecurityExtension } from './saved_objects_security_extension';

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type {
  HttpSelfClientDispatchConfig,
  HttpSelfRunCredential,
  KibanaRequest,
} from '@kbn/core-http-server';
import type { Logger } from '@kbn/logging';
import { BasePath } from './base_path_service';
import { AuthHeadersStorage } from './auth_headers_storage';
import { createInternalHttpSelfClient } from './self_client';

/** Reuses Core's transport and TLS profiles without constructing a listener or copying private keys. */
export const createWorkerHttpService = (
  config: HttpSelfClientDispatchConfig,
  log: Logger,
  identity: { readonly authorization: string; readonly uiamAttestation?: string },
  refreshRunCredential?: () => Promise<HttpSelfRunCredential | null>
) => {
  let refreshed: HttpSelfRunCredential | null = null;
  let pending: Promise<HttpSelfRunCredential | null> | undefined;
  const basePath = new BasePath(config.basePath, config.publicBaseUrl);
  const selfClient = createInternalHttpSelfClient({
    basePath,
    authRequestHeaders: new AuthHeadersStorage(),
    getServerInfo: () => config.serverInfo,
    getHttpConfig: () => ({
      selfHttp: { maxRedirects: config.maxRedirects, ssl: { verificationMode: 'full' } },
      // Portable TLS/mTLS policy below replaces the listener's private configuration.
      ssl: { enabled: false, requestCert: false, rejectUnauthorized: false },
    }),
    ssl: config.ssl,
    kibanaVersion: config.kibanaVersion,
    log,
    target: config.target,
    getUiamAttestationGetter: () => (_request: KibanaRequest, authorization: string | null) =>
      authorization === identity.authorization
        ? identity.uiamAttestation
        : authorization === refreshed?.authorization
        ? refreshed.uiamAttestation
        : undefined,
    getUnauthorizedErrorHandler: () =>
      refreshRunCredential
        ? async (_options, toolkit) => {
            pending ??= refreshRunCredential().finally(() => {
              pending = undefined;
            });
            refreshed = await pending;
            return refreshed
              ? toolkit.retry({ authHeaders: { authorization: refreshed.authorization } })
              : toolkit.notHandled();
          }
        : undefined,
  });
  return { basePath, selfClient, getServerInfo: () => config.serverInfo };
};

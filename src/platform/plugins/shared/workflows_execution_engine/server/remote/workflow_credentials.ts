/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { CoreStart, KibanaRequest } from '@kbn/core/server';
import type { HttpSelfRunCredential } from '@kbn/core-http-server';
import { remotable } from '@kbn/core-remote-common';
import type { ScopeLookup } from '@kbn/core-remote-server';
import type { WorkflowCredentialsApi } from './tokens';

/** Keeps credential refresh material in Core; only the scoped short-lived result crosses the seam. */
@remotable()
export class WorkflowCredentials implements WorkflowCredentialsApi {
  private readonly pending = new Map<string, Promise<HttpSelfRunCredential | null>>();

  constructor(private readonly core: CoreStart, private readonly scopes: ScopeLookup) {}

  refreshRunCredential(scopeId: string): Promise<HttpSelfRunCredential | null> {
    const signal = this.scopes.getAbortSignal(scopeId);
    signal.throwIfAborted();
    const request = this.scopes.get<KibanaRequest>(scopeId);
    let pending = this.pending.get(scopeId);
    if (!pending) {
      pending = this.core.http.selfClient
        .refreshRunCredential(request, signal)
        .then((credential) =>
          credential
            ? {
                authorization: credential.authorization,
                uiamAttestation: credential.uiamAttestation,
              }
            : null
        )
        .finally(() => this.pending.delete(scopeId));
      this.pending.set(scopeId, pending);
    }
    return pending;
  }
}

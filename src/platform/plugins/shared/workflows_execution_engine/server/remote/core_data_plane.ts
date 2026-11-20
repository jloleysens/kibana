/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { CoreStart, ElasticsearchClient, KibanaRequest } from '@kbn/core/server';
import type { ScopeLookup } from '@kbn/core-remote-server';
import type { WorkflowDataPlaneApi } from './tokens';

/** Borrows Core's authenticated clients in-process without creating or closing duplicate clients. */
export class CoreDataPlane implements WorkflowDataPlaneApi {
  private readonly users = new Map<string, ElasticsearchClient>();

  constructor(private readonly core: CoreStart, private readonly scopes: ScopeLookup) {}

  async open(scopeId: string): Promise<void> {
    const request = this.scopes.get<KibanaRequest>(scopeId);
    this.users.set(scopeId, this.core.elasticsearch.client.asScoped(request).asCurrentUser);
  }

  async close(scopeId: string): Promise<void> {
    this.users.delete(scopeId);
  }

  internal(): ElasticsearchClient {
    return this.core.elasticsearch.client.asInternalUser;
  }

  user(scopeId: string): ElasticsearchClient {
    const client = this.users.get(scopeId);
    if (!client) throw new Error('Workflow data-plane scope is closed');
    return client;
  }
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { Client } from '@elastic/elasticsearch';
import type { ElasticsearchClient } from '@kbn/core/server';
import { remotable } from '@kbn/core-remote-common';
import type { WorkflowDataPlaneApi, WorkflowDispatchCredentials } from './tokens';

interface Clients {
  readonly internal: Client;
  readonly user: Client;
}

/** Binds memory-only dispatch credentials to distinct internal and run-user clients. */
@remotable()
export class ExecutorDataPlane implements WorkflowDataPlaneApi {
  private readonly clients = new Map<string, Clients>();
  private activeScopeId?: string;

  async open(scopeId: string, credentials?: WorkflowDispatchCredentials): Promise<void> {
    if (!credentials?.internalHeaders.authorization || !credentials.userHeaders.authorization) {
      throw new Error(
        'Worker dispatch requires separate internal and run-user authorization headers'
      );
    }
    if (this.activeScopeId !== undefined)
      throw new Error('Worker already has an active workflow lease');
    this.activeScopeId = scopeId;
    try {
      const { Client } = await import('@elastic/elasticsearch');
      this.clients.set(scopeId, {
        internal: new Client({
          node: credentials.node,
          headers: { ...credentials.internalHeaders, 'x-elastic-product-origin': 'kibana' },
        }),
        user: new Client({
          node: credentials.node,
          headers: { ...credentials.userHeaders, 'x-elastic-product-origin': 'kibana' },
        }),
      });
    } catch (error) {
      this.activeScopeId = undefined;
      throw error;
    }
  }

  async close(scopeId: string): Promise<void> {
    const clients = this.clients.get(scopeId);
    if (!clients) return;
    this.clients.delete(scopeId);
    try {
      await Promise.all([clients.internal.close(), clients.user.close()]);
    } finally {
      this.activeScopeId = undefined;
    }
  }

  internal(scopeId?: string): ElasticsearchClient {
    if (scopeId) return this.get(scopeId).internal;
    const [clients] = this.clients.values();
    if (!clients || this.clients.size !== 1) throw new Error('No unique active workflow lease');
    return clients.internal;
  }

  user(scopeId: string): ElasticsearchClient {
    return this.get(scopeId).user;
  }

  private get(scopeId: string): Clients {
    const clients = this.clients.get(scopeId);
    if (!clients) throw new Error('Workflow data-plane scope is closed');
    return clients;
  }
}

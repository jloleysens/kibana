/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ConnectorTokenStore } from '../types';
import type { ConnectorTokenRequest, ConnectorTokenResponse, PreparedConnector } from './types';

type StoredToken = ConnectorTokenResponse['connectorToken'];

/** Restricts token persistence to the prepared identity and tokens read by this invocation. */
export class ConnectorTokenState {
  private readonly tokens = new Map<string, NonNullable<StoredToken>>();
  private readMissing = false;
  private closed = false;

  constructor(
    private readonly client: ConnectorTokenStore,
    private readonly identity: Pick<PreparedConnector, 'actionId' | 'authMode' | 'profileUid'>,
    private readonly signal: AbortSignal
  ) {}

  async execute(request: ConnectorTokenRequest): Promise<ConnectorTokenResponse> {
    this.signal.throwIfAborted();
    if (this.closed) throw new Error('Connector token invocation is closed');
    const { actionId: connectorId, authMode, profileUid } = this.identity;
    if (authMode === 'per-user' && !profileUid) {
      throw new Error('Per-user connector token access requires the prepared profile');
    }
    const identity = { connectorId, ...(authMode === 'per-user' ? { profileUid } : {}) };
    let connectorToken: StoredToken = null;
    switch (request.operation) {
      case 'get': {
        const { tokenType, credentialType } = request.options;
        if (tokenType !== undefined && tokenType !== 'access_token') {
          throw new Error('Unsupported execution token type');
        }
        if (credentialType !== undefined && credentialType !== 'oauth') {
          throw new Error('Unsupported execution credential type');
        }
        const result = await this.client.get({ ...identity, tokenType, credentialType });
        this.signal.throwIfAborted();
        if (this.closed) throw new Error('Connector token invocation is closed');
        if (result.connectorToken?.id) {
          this.tokens.set(result.connectorToken.id, result.connectorToken);
        } else if (result.connectorToken === null) {
          this.readMissing = true;
        }
        return result;
      }
      case 'replace': {
        const { token, ...update } = request.options;
        const original = token?.id ? this.tokens.get(token.id) ?? null : null;
        if ((token && !original) || (!token && !this.readMissing)) {
          throw new Error('Connector token replacement requires an invocation-local read');
        }
        // Never trust the worker's copy of the old token or its saved-object identity.
        await this.client.updateOrReplace({
          ...update,
          ...identity,
          token: original,
        });
        break;
      }
      case 'refresh': {
        const { id } = request.options;
        if (!this.tokens.has(id)) {
          throw new Error('Connector token refresh requires an invocation-local read');
        }
        connectorToken = await this.client.updateWithRefreshToken(request.options);
        break;
      }
      case 'delete':
        await this.client.deleteConnectorTokens({ ...identity, authMode });
        this.tokens.clear();
        this.readMissing = false;
        break;
      default:
        throw new Error('Unsupported connector token operation');
    }
    return { hasErrors: false, connectorToken };
  }

  close(): void {
    this.closed = true;
    this.tokens.clear();
    this.readMissing = false;
  }
}

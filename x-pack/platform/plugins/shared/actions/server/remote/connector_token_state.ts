/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { withConnectorTokenRefreshLock } from '../lib/with_connector_token_refresh_lock';
import type { ConnectorTokenStore } from '../types';
import type { ConnectorTokenRequest, ConnectorTokenResponse, PreparedConnector } from './types';

type StoredToken = ConnectorTokenResponse['connectorToken'];

/** Restricts token persistence to the prepared identity and tokens read by this invocation. */
export class ConnectorTokenState {
  private readonly tokens = new Map<string, NonNullable<StoredToken>>();
  private readMissing = false;
  private closed = false;
  private refreshLock?: Promise<void>;
  private releaseRefreshLock?: () => void;
  private rejectRefreshLock?: (error: Error) => void;
  private readonly onAbort = () => this.close();

  constructor(
    private readonly client: ConnectorTokenStore,
    private readonly identity: Pick<PreparedConnector, 'actionId' | 'authMode' | 'profileUid'>,
    private readonly signal: AbortSignal,
    private readonly refreshEars?: (
      refreshToken: string
    ) => Promise<import('../lib/request_oauth_token').OAuthTokenResponse>
  ) {
    signal.addEventListener('abort', this.onAbort, { once: true });
    if (signal.aborted) this.close();
  }

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
      case 'acquireRefreshLock':
        await this.acquireRefreshLock();
        break;
      case 'releaseRefreshLock':
        await this.releaseLock();
        break;
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
      case 'refreshEars': {
        if (!this.refreshEars || !this.releaseRefreshLock)
          throw new Error(
            'EARS refresh transport requires the prepared identity and held refresh lock'
          );
        const matched = [...this.tokens.values()].some((token) => {
          const credentials = 'credentials' in token ? token.credentials : undefined;
          const stored =
            authMode === 'per-user' &&
            credentials &&
            typeof credentials === 'object' &&
            'refreshToken' in credentials
              ? credentials.refreshToken
              : 'refreshToken' in token
              ? token.refreshToken
              : undefined;
          return typeof stored === 'string' && stored === request.refreshToken;
        });
        if (!matched) throw new Error('EARS refresh requires an invocation-local token read');
        try {
          const earsToken = await this.refreshEars(request.refreshToken);
          this.signal.throwIfAborted();
          if (this.closed) throw new Error('Connector token invocation is closed');
          return { hasErrors: false, connectorToken: null, earsToken };
        } catch {
          // Deployment identity/network errors must not carry TLS keys or Axios configuration to the worker.
          throw new Error('Failed to refresh token from auth redirect service');
        }
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

  private async acquireRefreshLock(): Promise<void> {
    if (this.refreshLock) throw new Error('Connector invocation already requested a refresh lock');
    const { actionId, authMode, profileUid } = this.identity;
    const key = authMode === 'per-user' ? `${actionId}:${profileUid}` : actionId;
    let acquired: () => void = () => {};
    let rejected: (error: Error) => void = () => {};
    const ready = new Promise<void>((resolve, reject) => {
      acquired = resolve;
      rejected = reject;
    });
    this.rejectRefreshLock = rejected;
    this.refreshLock = withConnectorTokenRefreshLock(key, async () => {
      if (this.closed || this.signal.aborted)
        throw new Error('Connector token invocation is closed');
      await new Promise<void>((resolve) => {
        this.releaseRefreshLock = resolve;
        acquired();
      });
    });
    void this.refreshLock.catch(rejected);
    await ready;
    this.rejectRefreshLock = undefined;
  }

  private async releaseLock(): Promise<void> {
    if (!this.releaseRefreshLock)
      throw new Error('Connector invocation has no acquired refresh lock');
    this.releaseRefreshLock();
    await this.refreshLock;
    this.releaseRefreshLock = undefined;
    this.refreshLock = undefined;
  }

  close(): void {
    this.closed = true;
    this.signal.removeEventListener('abort', this.onAbort);
    this.rejectRefreshLock?.(new Error('Connector token invocation is closed'));
    this.rejectRefreshLock = undefined;
    this.releaseRefreshLock?.();
    this.tokens.clear();
    this.readMissing = false;
  }
}

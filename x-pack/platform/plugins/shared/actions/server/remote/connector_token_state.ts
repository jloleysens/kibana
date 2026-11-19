/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { setTimeout, clearTimeout } from 'node:timers';
import { randomUUID } from 'node:crypto';
import type { Logger } from '@kbn/core/server';
import { withConnectorTokenRefreshLock } from '../lib/with_connector_token_refresh_lock';
import type { ConnectorTokenStore } from '../types';
import type { ConnectorTokenRequest, ConnectorTokenResponse, PreparedConnector } from './types';

type StoredToken = ConnectorTokenResponse['connectorToken'];

/** Restricts token persistence to the prepared identity and tokens read by this invocation. */
export class ConnectorTokenState {
  private readonly tokens = new Map<string, NonNullable<StoredToken>>();
  private readMissing = false;
  private earsRefresh?: Promise<ConnectorTokenResponse>;
  private persistedEarsRefresh?: {
    options: Parameters<ConnectorTokenStore['updateWithRefreshToken']>[0];
    connectorToken: StoredToken;
  };
  private refreshLease?: {
    id: string;
    token: string;
    timeout: NodeJS.Timeout;
    persistence?: Promise<StoredToken>;
    settled?: boolean;
  };
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
    ) => Promise<import('../lib/request_oauth_token').OAuthTokenResponse>,
    private readonly logger?: Pick<Logger, 'error'>
  ) {
    signal.addEventListener('abort', this.onAbort, { once: true });
    if (signal.aborted) this.close();
  }

  async execute(request: ConnectorTokenRequest): Promise<ConnectorTokenResponse> {
    const latePersistence =
      this.refreshLease &&
      (request.operation === 'refresh' || request.operation === 'endRefresh') &&
      request.refreshLease === this.refreshLease.token;
    if (!latePersistence) this.signal.throwIfAborted();
    if (this.closed && !latePersistence) throw new Error('Connector token invocation is closed');
    const { actionId: connectorId, authMode, profileUid } = this.identity;
    if (authMode === 'per-user' && !profileUid) {
      throw new Error('Per-user connector token access requires the prepared profile');
    }
    const identity = { connectorId, ...(authMode === 'per-user' ? { profileUid } : {}) };
    let connectorToken: StoredToken = null;
    switch (request.operation) {
      case 'beginRefresh': {
        if (!this.releaseRefreshLock || !this.tokens.has(request.id) || this.refreshLease)
          throw new Error(
            'OAuth refresh transaction requires a held lock and invocation-local read'
          );
        const token = randomUUID();
        // A lost worker cannot retain the shared refresh mutex indefinitely.
        const timeout = setTimeout(() => {
          this.logger?.error(
            'OAuth refresh transaction expired before completion; credentials may be lost'
          );
          this.endRefreshLease();
        }, 120_000);
        timeout.unref();
        this.refreshLease = { id: request.id, token, timeout };
        return { hasErrors: false, connectorToken: null, refreshLease: token };
      }
      case 'endRefresh':
        if (!latePersistence) throw new Error('Unknown OAuth refresh transaction lease');
        try {
          await this.refreshLease?.persistence;
        } finally {
          this.endRefreshLease();
        }
        break;
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
        const matched = [...this.tokens.values()].find((token) => {
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
        if (!matched.id) throw new Error('EARS refresh requires a stored token id');
        const refresh = this.refreshEars;
        const id = matched.id;
        // The provider may invalidate the old refresh token. Abort only the caller's wait,
        // never the refresh + persistence transaction protected by the shared lock.
        const transaction = (async (): Promise<ConnectorTokenResponse> => {
          try {
            const earsToken = await refresh(request.refreshToken);
            const options = {
              id,
              token: `${earsToken.tokenType} ${earsToken.accessToken}`,
              refreshToken: earsToken.refreshToken ?? request.refreshToken,
              expiresIn: earsToken.expiresIn,
              refreshTokenExpiresIn: earsToken.refreshTokenExpiresIn,
              tokenType: 'access_token',
            };
            const updated = await this.client.updateWithRefreshToken(options);
            this.persistedEarsRefresh = { options, connectorToken: updated };
            return { hasErrors: false, connectorToken: null, earsToken };
          } catch (error) {
            this.logger?.error(error);
            // Deployment identity/network errors must never carry TLS/HTTP metadata to the worker.
            throw new Error('Failed to refresh token from auth redirect service');
          } finally {
            this.earsRefresh = undefined;
            if (this.closed) this.clear();
          }
        })();
        this.earsRefresh = transaction;
        let onAbort = () => {};
        const aborted = new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new Error('Connector token invocation is closed'));
          this.signal.addEventListener('abort', onAbort, { once: true });
          if (this.signal.aborted) onAbort();
        });
        try {
          return await Promise.race([transaction, aborted]);
        } finally {
          this.signal.removeEventListener('abort', onAbort);
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
        if (
          request.refreshLease !== undefined &&
          (!latePersistence || this.refreshLease?.id !== id)
        )
          throw new Error('Unknown OAuth refresh transaction lease');
        if (this.refreshLease && (!latePersistence || this.refreshLease.id !== id))
          throw new Error('OAuth refresh requires its transaction lease');
        if (!this.tokens.has(id)) {
          throw new Error('Connector token refresh requires an invocation-local read');
        }
        const persisted = this.persistedEarsRefresh;
        this.persistedEarsRefresh = undefined;
        if (
          persisted &&
          request.options.id === persisted.options.id &&
          request.options.token === persisted.options.token &&
          request.options.refreshToken === persisted.options.refreshToken &&
          request.options.expiresIn === persisted.options.expiresIn &&
          request.options.refreshTokenExpiresIn === persisted.options.refreshTokenExpiresIn &&
          request.options.tokenType === persisted.options.tokenType &&
          request.options.credentialType === persisted.options.credentialType
        ) {
          connectorToken = persisted.connectorToken;
        } else {
          const lease = this.refreshLease;
          if (lease) {
            if (lease.persistence) throw new Error('OAuth refresh transaction already persisted');
            clearTimeout(lease.timeout);
            lease.persistence = this.client.updateWithRefreshToken(request.options);
            try {
              connectorToken = await lease.persistence;
            } finally {
              lease.settled = true;
              if (this.closed) this.clear();
            }
          } else {
            connectorToken = await this.client.updateWithRefreshToken(request.options);
          }
        }
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
    if (this.refreshLease?.settled) this.clear();
    if (!this.earsRefresh && !this.refreshLease) this.clear();
  }

  private endRefreshLease(): void {
    if (this.refreshLease) clearTimeout(this.refreshLease.timeout);
    this.refreshLease = undefined;
    if (this.closed) this.clear();
  }

  private clear(): void {
    this.releaseRefreshLock?.();
    this.persistedEarsRefresh = undefined;
    this.tokens.clear();
    this.readMissing = false;
  }
}

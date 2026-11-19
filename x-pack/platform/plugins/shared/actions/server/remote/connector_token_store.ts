/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import pLimit from 'p-limit';
import type { ConnectorToken, ConnectorTokenStore, UserConnectorToken } from '../types';
import type { NativeActionsApi, ConnectorTokenResponse } from './types';

/** Adapts the original token strategies to invocation-bound coordinator storage. */
export const createConnectorTokenStore = (
  actions: NativeActionsApi,
  scopeId: string,
  invocationId: string,
  earsTransportAvailable = false
): ConnectorTokenStore => {
  const refreshQueue = pLimit(1);
  let refreshLease: string | undefined;
  const token = (request: Parameters<NativeActionsApi['token']>[2]) =>
    actions.token(scopeId, invocationId, request);
  type GetOptions = Parameters<ConnectorTokenStore['get']>[0];
  function get(
    options: Omit<GetOptions, 'profileUid'>
  ): Promise<{ hasErrors: boolean; connectorToken: ConnectorToken | null }>;
  function get(
    options: GetOptions & { profileUid: string }
  ): Promise<{ hasErrors: boolean; connectorToken: UserConnectorToken | null }>;
  function get(options: GetOptions): Promise<ConnectorTokenResponse>;
  async function get(options: GetOptions): Promise<ConnectorTokenResponse> {
    return token({
      operation: 'get',
      options: { tokenType: options.tokenType, credentialType: options.credentialType },
    });
  }
  return {
    ...(earsTransportAvailable
      ? {
          refreshEars: async (refreshToken: string) => {
            const response = await token({ operation: 'refreshEars', refreshToken });
            if (!response.earsToken) throw new Error('EARS refresh transport returned no token');
            return response.earsToken;
          },
        }
      : {}),
    get,
    ...(!earsTransportAvailable
      ? {
          withRefreshTransaction: async <T>(id: string, refresh: () => Promise<T>): Promise<T> => {
            const response = await token({ operation: 'beginRefresh', id });
            if (!response.refreshLease)
              throw new Error('Missing connector refresh transaction lease');
            refreshLease = response.refreshLease;
            try {
              return await refresh();
            } finally {
              const lease = refreshLease;
              refreshLease = undefined;
              await token({ operation: 'endRefresh', refreshLease: lease });
            }
          },
        }
      : {}),
    withRefreshLock: (refresh) =>
      refreshQueue(async () => {
        await token({ operation: 'acquireRefreshLock' });
        let result;
        try {
          result = await refresh();
        } catch (error) {
          // Scope closure also releases the coordinator lease; cleanup cannot replace the auth error.
          await token({ operation: 'releaseRefreshLock' }).catch(() => {});
          throw error;
        }
        await token({ operation: 'releaseRefreshLock' });
        return result;
      }),
    updateOrReplace: async ({
      token: original,
      newToken,
      expiresInSec,
      tokenRequestDate,
      deleteExisting,
    }) => {
      await token({
        operation: 'replace',
        options: { token: original, newToken, expiresInSec, tokenRequestDate, deleteExisting },
      });
    },
    updateWithRefreshToken: async (options) =>
      (await token({ operation: 'refresh', options, ...(refreshLease ? { refreshLease } : {}) }))
        .connectorToken,
    deleteConnectorTokens: async () => {
      await token({ operation: 'delete' });
    },
  };
};

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ConnectorTokenState } from './connector_token_state';
import { createConnectorTokenStore } from './connector_token_store';
import type { ConnectorToken, ConnectorTokenStore } from '../types';
import type { NativeActionsApi } from './types';

const stored: ConnectorToken = {
  id: 'shared:read-token',
  connectorId: 'prepared',
  tokenType: 'access_token',
  token: 'Bearer old',
  createdAt: new Date().toISOString(),
};
const setup = (perUser = false) => {
  const get = jest.fn().mockResolvedValue({ hasErrors: false, connectorToken: stored });
  const client: jest.Mocked<ConnectorTokenStore> = {
    get,
    updateOrReplace: jest.fn().mockResolvedValue(undefined),
    updateWithRefreshToken: jest.fn().mockResolvedValue(stored),
    deleteConnectorTokens: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new AbortController();
  const state = new ConnectorTokenState(
    client,
    {
      actionId: 'prepared',
      authMode: perUser ? 'per-user' : 'shared',
      profileUid: 'prepared-user',
    },
    controller.signal
  );
  const token = jest.fn<
    ReturnType<NativeActionsApi['token']>,
    Parameters<NativeActionsApi['token']>
  >(async (_scope, _invocation, request) => state.execute(request));
  const actions: NativeActionsApi = {
    dashboard: jest.fn(),
    relay: jest.fn(),
    prepare: jest.fn(),
    finalize: jest.fn(),
    token,
  };
  return {
    state,
    client,
    controller,
    token,
    store: createConnectorTokenStore(actions, 'scope', 'invocation'),
  };
};

it.each([false, true])(
  'pins connector/profile identity rather than accepting worker identities (per-user=%s)',
  async (perUser) => {
    const { store, client, token } = setup(perUser);
    await store.get({ connectorId: 'other', profileUid: 'other-user', tokenType: 'access_token' });
    expect(client.get).toHaveBeenCalledWith({
      connectorId: 'prepared',
      ...(perUser ? { profileUid: 'prepared-user' } : {}),
      tokenType: 'access_token',
      credentialType: undefined,
    });
    await store.deleteConnectorTokens({ connectorId: 'other', profileUid: 'other-user' });
    expect(client.deleteConnectorTokens).toHaveBeenCalledWith({
      connectorId: 'prepared',
      ...(perUser ? { profileUid: 'prepared-user' } : {}),
      authMode: perUser ? 'per-user' : 'shared',
    });
    expect(
      token.mock.calls.every(
        ([scope, invocation]) => scope === 'scope' && invocation === 'invocation'
      )
    ).toBe(true);
  }
);

it('binds replacements to coordinator read snapshots and refreshes to read token ids', async () => {
  const { store, client } = setup();
  const replace = {
    connectorId: 'other',
    token: stored,
    newToken: 'Bearer new',
    tokenRequestDate: 1,
    deleteExisting: false,
  };
  await expect(store.updateOrReplace(replace)).rejects.toThrow('invocation-local read');
  await expect(store.updateWithRefreshToken({ id: stored.id ?? '', token: 'new' })).rejects.toThrow(
    'invocation-local read'
  );
  await store.get({ connectorId: 'prepared' });
  await store.updateOrReplace({
    ...replace,
    token: { ...stored, connectorId: 'forged', token: 'forged' },
  });
  expect(client.updateOrReplace).toHaveBeenCalledWith({
    ...replace,
    connectorId: 'prepared',
    token: stored,
  });
  await store.updateWithRefreshToken({
    id: stored.id ?? '',
    token: 'new',
    refreshToken: 'rotated',
  });
  expect(client.updateWithRefreshToken).toHaveBeenCalledWith({
    id: stored.id,
    token: 'new',
    refreshToken: 'rotated',
  });
  await expect(store.updateWithRefreshToken({ id: 'other', token: 'new' })).rejects.toThrow(
    'invocation-local read'
  );
  await store.deleteConnectorTokens({ connectorId: 'prepared' });
  await expect(store.updateWithRefreshToken({ id: stored.id ?? '', token: 'new' })).rejects.toThrow(
    'invocation-local read'
  );
});

it('permits initial token creation only after a missing-token read and preserves original storage failures', async () => {
  const { store, client } = setup();
  const replace = {
    connectorId: 'prepared',
    token: null,
    newToken: 'new',
    tokenRequestDate: 1,
    deleteExisting: true,
  };
  await expect(store.updateOrReplace(replace)).rejects.toThrow('invocation-local read');
  client.get.mockResolvedValue({ hasErrors: true, connectorToken: null });
  await expect(store.get({ connectorId: 'prepared' })).resolves.toEqual({
    hasErrors: true,
    connectorToken: null,
  });
  const failure = new Error('storage unavailable');
  client.updateOrReplace.mockRejectedValue(failure);
  await expect(store.updateOrReplace(replace)).rejects.toBe(failure);
});

it('rejects unsupported token selectors, aborted scopes, closed invocations and missing per-user identity', async () => {
  const { state, store, client, controller } = setup();
  await expect(store.get({ connectorId: 'prepared', credentialType: 'unrelated' })).rejects.toThrow(
    'credential type'
  );
  await expect(store.get({ connectorId: 'prepared', tokenType: 'unrelated' })).rejects.toThrow(
    'token type'
  );
  expect(client.get).not.toHaveBeenCalled();
  state.close();
  await expect(store.get({ connectorId: 'prepared' })).rejects.toThrow('closed');
  controller.abort();
  await expect(store.get({ connectorId: 'prepared' })).rejects.toThrow();
  const unbound = new ConnectorTokenState(
    client,
    { actionId: 'prepared', authMode: 'per-user' },
    new AbortController().signal
  );
  await expect(unbound.execute({ operation: 'get', options: {} })).rejects.toThrow(
    'prepared profile'
  );
});

it('cannot retain a token read completed after invocation closure', async () => {
  const { state, store, client } = setup();
  let finish: (value: { hasErrors: boolean; connectorToken: ConnectorToken }) => void = () => {};
  client.get.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const pending = store.get({ connectorId: 'prepared' });
  state.close();
  finish({ hasErrors: false, connectorToken: stored });
  await expect(pending).rejects.toThrow('closed');
});

it('serializes remote refreshes with ordinary coordinator refreshes and releases on abort', async () => {
  const { withConnectorTokenRefreshLock } = await import(
    '../lib/with_connector_token_refresh_lock'
  );
  const first = setup();
  await first.state.execute({ operation: 'acquireRefreshLock' });
  let entered = false;
  const ordinary = withConnectorTokenRefreshLock('prepared', async () => {
    entered = true;
  });
  await Promise.resolve();
  expect(entered).toBe(false);
  first.controller.abort();
  await ordinary;
  expect(entered).toBe(true);
  const second = setup();
  await second.state.execute({ operation: 'acquireRefreshLock' });
  await second.state.execute({ operation: 'releaseRefreshLock' });
  second.state.close();
});

it('isolates per-user refresh locks and cancels queued acquisition without leaking a future grant', async () => {
  const first = setup();
  const queued = setup();
  const perUser = setup(true);
  await first.state.execute({ operation: 'acquireRefreshLock' });
  const acquisition = queued.state.execute({ operation: 'acquireRefreshLock' });
  await perUser.state.execute({ operation: 'acquireRefreshLock' });
  await perUser.state.execute({ operation: 'releaseRefreshLock' });
  perUser.state.close();
  queued.state.close();
  await expect(acquisition).rejects.toThrow('closed');
  await first.state.execute({ operation: 'releaseRefreshLock' });
  first.state.close();
  const next = setup();
  await next.state.execute({ operation: 'acquireRefreshLock' });
  await expect(next.state.execute({ operation: 'acquireRefreshLock' })).rejects.toThrow(
    'already requested'
  );
  await next.state.execute({ operation: 'releaseRefreshLock' });
  next.state.close();
});

it('preserves refresh failures while releasing its coordinator lock', async () => {
  const { store, state } = setup();
  const failure = new Error('invalid_grant');
  await expect(
    store.withRefreshLock?.(async () => {
      throw failure;
    })
  ).rejects.toBe(failure);
  await expect(store.withRefreshLock?.(async () => 'token')).resolves.toBe('token');
  state.close();
});

it('runs the original stored-token strategy under the same lock as ordinary execution', async () => {
  const { getStoredTokenWithRefresh } = await import('../lib/get_stored_oauth_token_with_refresh');
  const { withConnectorTokenRefreshLock } = await import(
    '../lib/with_connector_token_refresh_lock'
  );
  const { loggingSystemMock } = await import('@kbn/core-logging-server-mocks');
  const { store, state, token, client } = setup();
  let release: () => void = () => {};
  let acquired: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const ordinary = withConnectorTokenRefreshLock('prepared', async () => {
    acquired();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  await ready;
  const worker = getStoredTokenWithRefresh({
    connectorId: 'prepared',
    connectorTokenClient: store,
    logger: loggingSystemMock.createLogger(),
    authMethod: 'oauth_authorization_code',
    refreshFn: async () => ({ accessToken: 'refreshed', tokenType: 'Bearer' }),
  });
  try {
    expect(token.mock.calls[0][2]).toEqual({ operation: 'acquireRefreshLock' });
    expect(client.get).not.toHaveBeenCalled();
  } finally {
    release();
    await ordinary;
    await worker;
    state.close();
  }
});

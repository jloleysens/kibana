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
    finalizeRetry: async () => {},
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
    await Promise.resolve();
    expect(token.mock.calls[0][2]).toEqual({ operation: 'acquireRefreshLock' });
    expect(client.get).not.toHaveBeenCalled();
  } finally {
    release();
    await ordinary;
    await worker;
    state.close();
  }
});

it('pins deployment-authenticated EARS refresh to a held lock and a refresh token read in this invocation', async () => {
  const { client, controller } = setup();
  client.get.mockResolvedValue({
    hasErrors: false,
    connectorToken: { ...stored, refreshToken: 'bound-refresh' },
  });
  const refreshed = {
    accessToken: 'Bearer renewed',
    tokenType: 'Bearer',
    expiresIn: 3600,
    refreshToken: 'rotated',
  };
  const refresh = jest.fn().mockResolvedValue(refreshed);
  const state = new ConnectorTokenState(
    client,
    { actionId: 'prepared', authMode: 'shared' },
    controller.signal,
    refresh
  );
  await expect(
    state.execute({ operation: 'refreshEars', refreshToken: 'bound-refresh' })
  ).rejects.toThrow('held refresh lock');
  await state.execute({ operation: 'acquireRefreshLock' });
  await expect(
    state.execute({ operation: 'refreshEars', refreshToken: 'bound-refresh' })
  ).rejects.toThrow('invocation-local token read');
  await state.execute({ operation: 'get', options: {} });
  await expect(state.execute({ operation: 'refreshEars', refreshToken: 'forged' })).rejects.toThrow(
    'invocation-local token read'
  );
  expect(
    (await state.execute({ operation: 'refreshEars', refreshToken: 'bound-refresh' })).earsToken
  ).toEqual(refreshed);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledWith('bound-refresh');
  await state.execute({
    operation: 'refresh',
    options: {
      id: stored.id ?? '',
      token: `${refreshed.tokenType} ${refreshed.accessToken}`,
      refreshToken: refreshed.refreshToken,
      expiresIn: refreshed.expiresIn,
      tokenType: 'access_token',
    },
  });
  expect(client.updateWithRefreshToken).toHaveBeenCalledTimes(1);
  await state.execute({ operation: 'releaseRefreshLock' });
  state.close();
  await expect(
    state.execute({ operation: 'refreshEars', refreshToken: 'bound-refresh' })
  ).rejects.toThrow('closed');
});

it('does not export deployment TLS keys, raw Axios configuration or response bodies on EARS failure', async () => {
  const { client, controller } = setup();
  client.get.mockResolvedValue({
    hasErrors: false,
    connectorToken: { ...stored, refreshToken: 'bound-refresh' },
  });
  const refresh = jest.fn().mockRejectedValue(
    Object.assign(new Error('system-key-in-message'), {
      config: { privateKey: 'system-key-in-config' },
    })
  );
  const state = new ConnectorTokenState(
    client,
    { actionId: 'prepared' },
    controller.signal,
    refresh
  );
  await state.execute({ operation: 'acquireRefreshLock' });
  await state.execute({ operation: 'get', options: {} });
  await expect(
    state.execute({ operation: 'refreshEars', refreshToken: 'bound-refresh' })
  ).rejects.toEqual(new Error('Failed to refresh token from auth redirect service'));
  state.close();
});

it('serializes concurrent OAuth refreshes within the same invocation', async () => {
  const { getStoredTokenWithRefresh } = await import('../lib/get_stored_oauth_token_with_refresh');
  const { loggingSystemMock } = await import('@kbn/core-logging-server-mocks');
  const { store, state, client } = setup();
  const order: string[] = [];
  let current = { ...stored, refreshToken: 'initial' };
  let generation = 0;
  client.get.mockImplementation(async () => ({ hasErrors: false, connectorToken: current }));
  client.updateWithRefreshToken.mockImplementation(async (update) => {
    current = { ...current, ...update, refreshToken: update.refreshToken ?? current.refreshToken };
    return current;
  });
  const refreshFn = async (refreshToken: string) => {
    expect(refreshToken).toBe(current.refreshToken);
    const id = ++generation;
    order.push(id + ':start');
    await new Promise((resolve) => setImmediate(resolve));
    order.push(id + ':end');
    return { tokenType: 'Bearer', accessToken: 'new-' + id, refreshToken: 'rotated-' + id };
  };
  const refresh = () =>
    getStoredTokenWithRefresh({
      connectorId: 'prepared',
      connectorTokenClient: store,
      logger: loggingSystemMock.createLogger(),
      authMethod: 'oauth_authorization_code',
      forceRefresh: true,
      refreshFn,
    });
  await expect(Promise.all([refresh(), refresh()])).resolves.toEqual([
    'Bearer new-1',
    'Bearer new-2',
  ]);
  expect(order).toEqual(['1:start', '1:end', '2:start', '2:end']);
  expect(client.updateWithRefreshToken).toHaveBeenCalledTimes(2);
  state.close();
});

it.each([false, true])(
  'persists rotated EARS credentials under the lock after abort (per-user=%s)',
  async (perUser) => {
    const { client, controller } = setup();
    let current = { ...stored, refreshToken: 'initial' };
    client.get.mockImplementation(async () => ({ hasErrors: false, connectorToken: current }));
    client.updateWithRefreshToken.mockImplementation(async (options) => {
      current = { ...current, ...options };
      return current;
    });
    let finish: () => void = () => {};
    const provider = jest.fn(async (refreshToken: string) => {
      expect(refreshToken).toBe(current.refreshToken);
      if (refreshToken === 'initial')
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      return { accessToken: 'new', tokenType: 'Bearer', refreshToken: refreshToken + '-rotated' };
    });
    const identity = {
      actionId: 'prepared',
      authMode: perUser ? ('per-user' as const) : ('shared' as const),
      profileUid: 'user',
    };
    if (perUser)
      client.get.mockImplementation(async () => ({
        hasErrors: false,
        connectorToken: {
          ...current,
          profileUid: 'user',
          credentials: { accessToken: current.token, refreshToken: current.refreshToken },
        },
      }));
    const first = new ConnectorTokenState(client, identity, controller.signal, provider);
    await first.execute({ operation: 'acquireRefreshLock' });
    await first.execute({ operation: 'get', options: {} });
    const pending = first.execute({ operation: 'refreshEars', refreshToken: 'initial' });
    controller.abort();
    const aborted = expect(pending).rejects.toThrow();
    const next = new ConnectorTokenState(client, identity, new AbortController().signal, provider);
    let acquired = false;
    const acquisition = next.execute({ operation: 'acquireRefreshLock' }).then(() => {
      acquired = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(acquired).toBe(false);
    finish();
    await aborted;
    await acquisition;
    expect(current.refreshToken).toBe('initial-rotated');
    await next.execute({ operation: 'get', options: {} });
    await next.execute({ operation: 'refreshEars', refreshToken: current.refreshToken });
    expect(current.refreshToken).toBe('initial-rotated-rotated');
    expect(client.updateWithRefreshToken).toHaveBeenCalledTimes(2);
    await next.execute({ operation: 'releaseRefreshLock' });
    next.close();
  }
);

it.each([undefined, 'oauth'])(
  'deduplicates only the exact EARS persistence acknowledgement (credentialType=%s)',
  async (credentialType) => {
    const { client, controller } = setup();
    client.get.mockResolvedValue({
      hasErrors: false,
      connectorToken: { ...stored, refreshToken: 'bound' },
    });
    const state = new ConnectorTokenState(
      client,
      { actionId: 'prepared' },
      controller.signal,
      async () => ({ accessToken: 'new', tokenType: 'Bearer', refreshToken: 'rotated' })
    );
    await state.execute({ operation: 'acquireRefreshLock' });
    await state.execute({ operation: 'get', options: {} });
    await state.execute({ operation: 'refreshEars', refreshToken: 'bound' });
    await state.execute({
      operation: 'refresh',
      options: {
        id: stored.id ?? '',
        token: 'Bearer new',
        refreshToken: 'rotated',
        tokenType: 'access_token',
        credentialType,
      },
    });
    expect(client.updateWithRefreshToken).toHaveBeenCalledTimes(
      credentialType === undefined ? 1 : 2
    );
    await state.execute({ operation: 'releaseRefreshLock' });
    state.close();
  }
);

it.each([false, true])(
  'persists ordinary authorization-code rotation after abort and serializes the next refresh (per-user=%s)',
  async (perUser) => {
    const { getStoredTokenWithRefresh } = await import(
      '../lib/get_stored_oauth_token_with_refresh'
    );
    const { loggingSystemMock } = await import('@kbn/core-logging-server-mocks');
    const first = setup(perUser);
    const second = setup(perUser);
    let current = { ...stored, refreshToken: 'initial' };
    const read = async () => ({
      hasErrors: false,
      connectorToken: perUser
        ? {
            ...current,
            profileUid: 'prepared-user',
            credentials: { accessToken: current.token, refreshToken: current.refreshToken },
          }
        : current,
    });
    const persist = async (
      options: Parameters<ConnectorTokenStore['updateWithRefreshToken']>[0]
    ) => {
      current = { ...current, ...options };
      return current;
    };
    for (const instance of [first, second]) {
      instance.client.get.mockImplementation(read);
      instance.client.updateWithRefreshToken.mockImplementation(persist);
    }
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const providerGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = jest.fn(async (refreshToken: string) => {
      expect(refreshToken).toBe(current.refreshToken);
      if (refreshToken === 'initial') {
        entered();
        await providerGate;
      }
      return { tokenType: 'Bearer', accessToken: 'new', refreshToken: refreshToken + '-rotated' };
    });
    const refresh = (instance: ReturnType<typeof setup>) =>
      getStoredTokenWithRefresh({
        connectorId: 'prepared',
        connectorTokenClient: instance.store,
        logger: loggingSystemMock.createLogger(),
        authMethod: 'oauth_authorization_code',
        forceRefresh: true,
        isPerUser: perUser,
        profileUid: 'prepared-user',
        refreshFn: provider,
      });
    const pending = refresh(first).catch(() => null);
    await ready;
    first.controller.abort();
    const next = refresh(second);
    await new Promise((resolve) => setImmediate(resolve));
    const callsBeforeRelease = provider.mock.calls.length;
    release();
    await pending;
    await next;
    expect(callsBeforeRelease).toBe(1);
    expect(current.refreshToken).toBe('initial-rotated-rotated');
    expect(first.client.updateWithRefreshToken).toHaveBeenCalledTimes(1);
    second.state.close();
  }
);

it('bounds an abandoned OAuth transaction and logs the lost-response risk before releasing its lease', async () => {
  const timer = jest.spyOn(
    jest.requireActual<typeof import('node:timers')>('node:timers'),
    'setTimeout'
  );
  const { client, controller } = setup();
  const logger = { error: jest.fn() };
  const first = new ConnectorTokenState(
    client,
    { actionId: 'prepared' },
    controller.signal,
    undefined,
    logger
  );
  const next = new ConnectorTokenState(
    client,
    { actionId: 'prepared' },
    new AbortController().signal
  );
  try {
    await first.execute({ operation: 'acquireRefreshLock' });
    await first.execute({ operation: 'get', options: {} });
    const lease = await first.execute({ operation: 'beginRefresh', id: stored.id ?? '' });
    controller.abort();
    let acquired = false;
    const acquisition = next.execute({ operation: 'acquireRefreshLock' }).then(() => {
      acquired = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(acquired).toBe(false);
    const expiry = timer.mock.calls.find(([, duration]) => duration === 120_000)?.[0];
    if (!expiry) throw new Error('Missing OAuth transaction deadline');
    expiry();
    await acquisition;
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('credentials may be lost'));
    await expect(
      first.execute({
        operation: 'refresh',
        refreshLease: lease.refreshLease,
        options: { id: stored.id ?? '', token: 'late' },
      })
    ).rejects.toThrow();
    expect(client.updateWithRefreshToken).not.toHaveBeenCalled();
    await next.execute({ operation: 'releaseRefreshLock' });
  } finally {
    first.close();
    next.close();
    timer.mockRestore();
  }
});

it('holds the aborted OAuth lease until an already received provider result finishes persisting', async () => {
  const { state, client, controller } = setup();
  let complete: (value: ConnectorToken) => void = () => {};
  client.updateWithRefreshToken.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    })
  );
  await state.execute({ operation: 'acquireRefreshLock' });
  await state.execute({ operation: 'get', options: {} });
  const lease = await state.execute({ operation: 'beginRefresh', id: stored.id ?? '' });
  const persisting = state.execute({
    operation: 'refresh',
    refreshLease: lease.refreshLease,
    options: { id: stored.id ?? '', token: 'Bearer rotated' },
  });
  controller.abort();
  const next = new ConnectorTokenState(
    client,
    { actionId: 'prepared' },
    new AbortController().signal
  );
  let acquired = false;
  const acquisition = next.execute({ operation: 'acquireRefreshLock' }).then(() => {
    acquired = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(acquired).toBe(false);
  complete(stored);
  await persisting;
  await acquisition;
  expect(acquired).toBe(true);
  await next.execute({ operation: 'releaseRefreshLock' });
  next.close();
});

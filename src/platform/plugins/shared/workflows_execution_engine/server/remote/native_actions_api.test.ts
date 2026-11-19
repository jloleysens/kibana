/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0, the GNU Affero General Public License v3.0 only, or the Server Side
 * Public License, v 1.
 */

import type { ConnectorFinalization } from '@kbn/actions-plugin/server';
import { actionsClientMock } from '@kbn/actions-plugin/server/mocks';
import { httpServerMock } from '@kbn/core-http-server-mocks';
import { NativeActions } from './native_actions_api';

const mockPrepare = jest.fn();
const mockFinalize = jest.fn();
const mockRefusalEvents = jest.fn();
const mockConstruct = jest.fn();
const mockToken = jest.fn();
const mockRelay = jest.fn();
const mockDashboard = jest.fn();

jest.mock('@kbn/actions-plugin/server', () => ({
  ...jest.requireActual('@kbn/actions-plugin/server'),
  PreparedExecution: class {
    constructor(...args: object[]) {
      mockConstruct(...args);
    }
    preparation = mockPrepare();
    finalize = mockFinalize;
    refusalEvents = mockRefusalEvents;
    token = mockToken;
    relay = mockRelay;
    dashboard = mockDashboard;
  },
}));

const setup = () => {
  const controller = new AbortController();
  const client = actionsClientMock.create();
  client.get.mockResolvedValue({
    id: 'saved-connector',
    name: 'Saved',
    actionTypeId: '.jenkins',
    config: {},
    isPreconfigured: false,
    isSystemAction: false,
    isDeprecated: false,
    isMissingSecrets: false,
    isConnectorTypeDeprecated: false,
  });
  client.finalizeExecutionEvents.mockResolvedValue();
  const request = httpServerMock.createKibanaRequest();
  const getClient = jest.fn(async () => client);
  const getScope = jest.fn().mockReturnValue(request);
  const logger = { error: jest.fn() };
  const api = new NativeActions(
    {
      get: getScope,
      getAbortSignal: () => controller.signal,
      getRunState: () => ({
        workflowRunId: 'run',
        workflowId: 'workflow',
        workflowName: 'Workflow',
        spaceId: 'default',
        admittedChildren: new Set(),
      }),
      resolveStepType: jest.fn(),
      resolveStepOutputLimit: jest.fn(),
      admitChild: jest.fn(),
    },
    getClient,
    undefined,
    logger
  );
  const input = { connectorType: 'jenkins', connectorNameOrId: 'saved-connector', input: {} };
  return { api, controller, client, request, getClient, input, getScope, logger };
};

const completion: ConnectorFinalization['runtime'] = {
  validatedParams: {},
  result: { status: 'ok', actionId: 'saved-connector' },
  errorType: 'other',
  executionStartedAt: 1,
  executionCompletedAt: 2,
  handlerStarted: true,
};

beforeEach(() => {
  jest.resetAllMocks();
  mockPrepare.mockReturnValue(Promise.resolve({ prepared: { marker: 'prepared' } }));
  mockFinalize.mockResolvedValue([{ message: 'original event' }]);
});

it('uses the scoped identity and a run-local cache, with one durable finalization batch', async () => {
  const { api, client, getClient, request, input } = setup();
  await api.prepare('scope', 'first', input);
  await api.prepare('scope', 'second', input);
  expect(getClient).toHaveBeenCalledTimes(1);
  expect(getClient).toHaveBeenCalledWith(request);
  expect(mockConstruct.mock.calls[0][5]).toBe(mockConstruct.mock.calls[1][5]);
  expect(client.finalizeExecutionEvents).not.toHaveBeenCalled();
  await api.finalize('scope', [
    { invocationId: 'first', runtime: completion },
    { invocationId: 'second', runtime: completion },
  ]);
  expect(mockFinalize).toHaveBeenCalledTimes(2);
  expect(client.finalizeExecutionEvents).toHaveBeenCalledWith([
    { message: 'original event' },
    { message: 'original event' },
  ]);
  await api.finalize('scope', [
    { invocationId: 'first', runtime: completion },
    { invocationId: 'second', runtime: completion },
  ]);
  expect(client.finalizeExecutionEvents).toHaveBeenCalledTimes(1);
  await expect(
    api.finalize('scope', [{ invocationId: 'first', runtime: completion }])
  ).rejects.toThrow('Unknown');
});

it('reserves invocation ids before asynchronous connector resolution', async () => {
  const { api, input } = setup();
  const pending = api.prepare('scope', 'same', input);
  await expect(api.prepare('scope', 'same', input)).rejects.toThrow('Duplicate');
  await pending;
});

it('validates the entire batch before resolving any execution, and propagates durable errors', async () => {
  const { api, client, input } = setup();
  await api.prepare('scope', 'first', input);
  await expect(
    api.finalize('scope', [
      { invocationId: 'first', runtime: completion },
      { invocationId: 'missing', runtime: completion },
    ])
  ).rejects.toThrow('Unknown');
  expect(mockFinalize).not.toHaveBeenCalled();
  client.finalizeExecutionEvents.mockRejectedValue(new Error('bulk failed'));
  await expect(
    api.finalize('scope', [{ invocationId: 'first', runtime: completion }])
  ).rejects.toThrow('bulk failed');
});

it('clears referenced-secret caches on scope closure and never shares them between runs', async () => {
  const { api, controller, input } = setup();
  await api.prepare('first-scope', 'first', input);
  const cache = mockConstruct.mock.calls[0][5];
  cache.set('referenced', Promise.resolve({ secrets: { password: 'test' } }));
  await api.prepare('second-scope', 'second', input);
  expect(mockConstruct.mock.calls[1][5]).not.toBe(cache);
  controller.abort();
  expect(cache.size).toBe(0);
  await expect(api.prepare('first-scope', 'third', input)).rejects.toThrow();
});

it('binds token calls to an active prepared invocation and refuses scope closure/finalized ids', async () => {
  const { api, input, controller } = setup();
  const request = { operation: 'get', options: {} } as const;
  await expect(api.token('scope', 'missing', request)).rejects.toThrow('Unknown');
  await api.prepare('scope', 'first', input);
  mockToken.mockResolvedValue({ hasErrors: false, connectorToken: null });
  await expect(api.token('scope', 'first', request)).resolves.toEqual({
    hasErrors: false,
    connectorToken: null,
  });
  expect(mockToken).toHaveBeenCalledWith(request);
  await api.finalize('scope', [{ invocationId: 'first', runtime: completion }]);
  await expect(api.token('scope', 'first', request)).rejects.toThrow('Unknown');
  controller.abort();
  await expect(api.token('scope', 'first', request)).rejects.toThrow();
});

it('exposes Relay transport only through an active invocation in the requesting scope', async () => {
  const { api, input, controller } = setup();
  const request = { operation: 'listBindings' } as const;
  await expect(api.relay('scope', 'missing', request)).rejects.toThrow('Unknown');
  await api.prepare('scope', 'first', input);
  mockRelay.mockResolvedValue({ operation: 'listBindings', result: { bindings: [] } });
  await expect(api.relay('scope', 'first', request)).resolves.toEqual({
    operation: 'listBindings',
    result: { bindings: [] },
  });
  expect(mockRelay).toHaveBeenCalledWith(request);
  await expect(api.relay('other', 'first', request)).rejects.toThrow('Unknown');
  await api.finalize('scope', [{ invocationId: 'first', runtime: completion }]);
  await expect(api.relay('scope', 'first', request)).rejects.toThrow('Unknown');
  controller.abort();
  await expect(api.relay('scope', 'first', request)).rejects.toThrow();
});

it('limits dashboard calls to active prepared invocations in the requesting scope', async () => {
  const { api, controller, input } = setup();
  await api.prepare('scope', 'dashboard', input);
  mockDashboard.mockResolvedValue({ value: { id: 'pinned' } });
  expect(await api.dashboard('scope', 'dashboard', { operation: 'get' })).toEqual({
    value: { id: 'pinned' },
  });
  expect(mockDashboard).toHaveBeenCalledWith({ operation: 'get' });
  await expect(api.dashboard('other', 'dashboard', { operation: 'get' })).rejects.toThrow(
    'Unknown'
  );
  await api.finalize('scope', [{ invocationId: 'dashboard', runtime: completion }]);
  await expect(api.dashboard('scope', 'dashboard', { operation: 'create' })).rejects.toThrow(
    'Unknown'
  );
  controller.abort();
  await expect(api.dashboard('scope', 'dashboard', { operation: 'get' })).rejects.toThrow();
});

it('retries cached events without consuming the continuation twice and deduplicates acknowledgements', async () => {
  const { api, client, input } = setup();
  await api.prepare('scope', 'first', input);
  const batch = [{ invocationId: 'first', runtime: completion }];
  mockFinalize
    .mockImplementationOnce(async () => [{ message: 'original event' }])
    .mockRejectedValue(new Error('continuation consumed'));
  client.finalizeExecutionEvents
    .mockRejectedValueOnce(new Error('bulk failed'))
    .mockResolvedValue();
  await expect(api.finalize('scope', batch)).rejects.toThrow('bulk failed');
  await Promise.all([api.finalizeRetry('scope', ['first']), api.finalizeRetry('scope', ['first'])]);
  await api.finalize('scope', batch);
  expect(mockFinalize).toHaveBeenCalledTimes(1);
  expect(client.finalizeExecutionEvents).toHaveBeenCalledTimes(2);
  expect(client.finalizeExecutionEvents.mock.calls[1][0]).toBe(
    client.finalizeExecutionEvents.mock.calls[0][0]
  );
});

it.each([
  'prepare',
  'finalize',
  'finalizeRetry',
  'token',
  'relay',
  'dashboard',
  'inference',
] as const)('exports only allowlisted errors from %s capabilities', async (family) => {
  const { api, client, input, getScope } = setup();
  const failure = Object.assign(new TypeError('service unavailable'), {
    config: { headers: { Authorization: 'Bearer coordinator-only-secret' } },
    meta: { request: { headers: { Authorization: 'Bearer coordinator-only-secret' } } },
    cause: new Error('coordinator-only-secret'),
  });
  let invoke: () => Promise<object | void>;
  if (family === 'prepare') {
    client.get.mockRejectedValue(failure);
    client.getAll.mockRejectedValue(failure);
    invoke = () => api.prepare('scope', 'first', input);
  } else if (family === 'inference') {
    mockPrepare.mockReturnValue(Promise.reject(failure));
    invoke = () => api.prepare('scope', 'first', { ...input, connectorType: 'inference' });
  } else {
    await api.prepare('scope', 'first', input);
    if (family === 'finalize') {
      client.finalizeExecutionEvents.mockRejectedValue(failure);
      invoke = () => api.finalize('scope', [{ invocationId: 'first', runtime: completion }]);
    } else if (family === 'finalizeRetry') {
      getScope.mockImplementationOnce(() => {
        throw failure;
      });
      invoke = () => api.finalizeRetry('scope', ['first']);
    } else if (family === 'token') {
      mockToken.mockRejectedValue(failure);
      invoke = () => api.token('scope', 'first', { operation: 'get', options: {} });
    } else if (family === 'relay') {
      mockRelay.mockRejectedValue(failure);
      invoke = () => api.relay('scope', 'first', { operation: 'listBindings' });
    } else {
      mockDashboard.mockRejectedValue(failure);
      invoke = () => api.dashboard('scope', 'first', { operation: 'get' });
    }
  }
  const error = await invoke().catch((caught: Error) => caught);
  expect(error).toBeInstanceOf(TypeError);
  if (!(error instanceof Error)) throw new Error('Expected safe error');
  expect(error).toMatchObject({ name: 'TypeError', message: 'service unavailable' });
  expect(Object.getOwnPropertyNames(error).sort()).toEqual(['message', 'name']);
  const wire = JSON.stringify({ ...error, name: error.name, message: error.message });
  expect(wire).not.toContain('coordinator-only-secret');
  expect(wire).not.toContain('Authorization');
});

it('logs a persistent event loss after one retry without failing the workflow or retrying forever', async () => {
  const { api, client, input, logger } = setup();
  await api.prepare('scope', 'first', input);
  const failure = Object.assign(new Error('event index unavailable'), {
    meta: { request: { headers: { Authorization: 'coordinator-only-secret' } } },
  });
  client.finalizeExecutionEvents.mockRejectedValue(failure);
  await expect(
    api.finalize('scope', [{ invocationId: 'first', runtime: completion }])
  ).rejects.toThrow('event index unavailable');
  await expect(api.finalizeRetry('scope', ['first'])).resolves.toBeUndefined();
  await api.finalizeRetry('scope', ['first']);
  await api.finalize('scope', [{ invocationId: 'first', runtime: completion }]);
  expect(client.finalizeExecutionEvents).toHaveBeenCalledTimes(2);
  expect(logger.error).toHaveBeenCalledWith(failure);
  expect(logger.error).toHaveBeenCalledWith(
    'Native connector event persistence failed after retry; event loss logged'
  );
});

it('returns the original preflight refusal after bounded event persistence failure and logs the loss', async () => {
  const { api, input, client, logger } = setup();
  const refusal = {
    result: { status: 'error', actionId: 'saved-connector', message: 'license refusal' },
  };
  mockPrepare.mockResolvedValue(refusal);
  const events = [{ message: 'preflight refused' }];
  mockRefusalEvents.mockResolvedValue(events);
  const failure = new Error('event index unavailable');
  client.finalizeExecutionEvents.mockRejectedValue(failure);
  await expect(api.prepare('scope', 'refused', input)).resolves.toBe(refusal);
  expect(mockRefusalEvents).toHaveBeenCalledTimes(1);
  expect(client.finalizeExecutionEvents).toHaveBeenCalledTimes(2);
  expect(client.finalizeExecutionEvents.mock.calls.every(([batch]) => batch === events)).toBe(true);
  expect(logger.error).toHaveBeenCalledWith(failure);
  expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('event loss logged'));
});

it('accepts only lease-bound late OAuth persistence after the requesting scope disappears', async () => {
  const { api, input, controller, getScope } = setup();
  await api.prepare('scope', 'invocation', input);
  mockToken.mockResolvedValue({
    hasErrors: false,
    connectorToken: null,
    refreshLease: 'coordinator-lease',
  });
  await api.token('scope', 'invocation', { operation: 'beginRefresh', id: 'read-token' });
  controller.abort();
  getScope.mockImplementation(() => {
    throw new Error('Scope no longer exists');
  });
  const update = {
    operation: 'refresh' as const,
    refreshLease: 'coordinator-lease',
    options: { id: 'read-token', token: 'Bearer rotated' },
  };
  await expect(api.token('other-scope', 'invocation', update)).rejects.toThrow('lease');
  await expect(api.token('scope', 'other-invocation', update)).rejects.toThrow('lease');
  await expect(
    api.token('scope', 'invocation', { ...update, refreshLease: 'forged' })
  ).rejects.toThrow('lease');
  await expect(api.token('scope', 'invocation', update)).resolves.toHaveProperty(
    'hasErrors',
    false
  );
  await api.token('scope', 'invocation', {
    operation: 'endRefresh',
    refreshLease: 'coordinator-lease',
  });
  await expect(api.token('scope', 'invocation', update)).rejects.toThrow('lease');
});

it('starts late OAuth route retention only after the requesting scope closes', async () => {
  const timer = jest.spyOn(
    jest.requireActual<typeof import('node:timers')>('node:timers'),
    'setTimeout'
  );
  const { api, input, controller } = setup();
  try {
    await api.prepare('scope', 'invocation', input);
    mockToken.mockResolvedValue({ hasErrors: false, connectorToken: null, refreshLease: 'lease' });
    await api.token('scope', 'invocation', { operation: 'beginRefresh', id: 'token' });
    expect(timer.mock.calls.some(([, duration]) => duration === 125_000)).toBe(false);
    controller.abort();
    expect(timer.mock.calls.some(([, duration]) => duration === 125_000)).toBe(true);
    await api.token('scope', 'invocation', { operation: 'endRefresh', refreshLease: 'lease' });
  } finally {
    timer.mockRestore();
  }
});

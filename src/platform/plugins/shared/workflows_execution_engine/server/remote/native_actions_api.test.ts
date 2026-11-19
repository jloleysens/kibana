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
  const api = new NativeActions(
    { get: jest.fn().mockReturnValue(request), getAbortSignal: () => controller.signal },
    getClient
  );
  const input = { connectorType: 'jenkins', connectorNameOrId: 'saved-connector', input: {} };
  return { api, controller, client, request, getClient, input };
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

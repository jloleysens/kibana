/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { connectorsSpecs, isConnectorAuthorizationError } from '@kbn/connector-specs';
import type { NativeActionsApi } from './types';
import { SpecRuntime } from './spec_runtime';

const mockConstruct = jest.fn();
const mockRun = jest.fn();
const mockRunClassic = jest.fn();
const mockDrain = jest.fn();
const mockClose = jest.fn();

jest.mock('./spec_runtime_impl', () => ({
  SpecRuntime: class {
    constructor(actions: NativeActionsApi) {
      mockConstruct(actions);
    }
    run = mockRun;
    runClassic = mockRunClassic;
    drain = mockDrain;
    close = mockClose;
  },
}));

const actions: NativeActionsApi = {
  dashboard: jest.fn(),
  relay: jest.fn(),
  token: jest.fn(),
  prepare: jest.fn(),
  finalizeRetry: async () => {},
  finalize: jest.fn(),
};
const services = { authTypes: [], isConnectorAuthorizationError };

beforeEach(() => {
  jest.resetAllMocks();
});

it('does not construct or import the capability for idle scopes', async () => {
  const runtime = new SpecRuntime(actions);
  await runtime.drain('unused');
  await runtime.close('unused');
  expect(mockConstruct).not.toHaveBeenCalled();
});

it('shares one first-use promise and one implementation across concurrent and warm steps', async () => {
  const runtime = new SpecRuntime(actions);
  const args = [connectorsSpecs.Jenkins, services, 'scope', {}] as const;
  await Promise.all([runtime.run(...args), runtime.run(...args)]);
  await runtime.run(...args);
  expect(mockConstruct).toHaveBeenCalledTimes(1);
  expect(mockConstruct).toHaveBeenCalledWith(actions);
  expect(mockRun).toHaveBeenCalledTimes(3);
  await runtime.drain('scope');
  await runtime.close('scope');
  expect(mockDrain).toHaveBeenCalledWith('scope');
  expect(mockClose).toHaveBeenCalledWith('scope');
});

it('surfaces a failed first use without poisoning the next attempt', async () => {
  mockConstruct.mockImplementationOnce(() => {
    throw new Error('load failed');
  });
  const runtime = new SpecRuntime(actions);
  await expect(runtime.run(connectorsSpecs.Jenkins, services, 'scope', {})).rejects.toThrow(
    'load failed'
  );
  await runtime.run(connectorsSpecs.Jenkins, services, 'scope', {});
  expect(mockConstruct).toHaveBeenCalledTimes(2);
  expect(mockRun).toHaveBeenCalledTimes(1);
});

it('forwards classic factories through the same lazy implementation without changing run', async () => {
  const runtime = new SpecRuntime(actions);
  const create = jest.fn();
  const controller = new AbortController();
  mockRunClassic.mockResolvedValue({ status: 'ok' });
  await expect(
    runtime.runClassic('email', create, 'scope', {}, controller.signal)
  ).resolves.toEqual({ status: 'ok' });
  expect(mockRunClassic).toHaveBeenCalledWith('email', create, 'scope', {}, controller.signal);
  expect(mockConstruct).toHaveBeenCalledTimes(1);
});

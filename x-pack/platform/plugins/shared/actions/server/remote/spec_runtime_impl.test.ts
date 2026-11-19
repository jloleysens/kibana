/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { connectorsSpecs, isConnectorAuthorizationError } from '@kbn/connector-specs';
import { SpecRuntime } from './spec_runtime_impl';
import type { NativeActionsApi, PreparedConnector } from './types';
import { configSchema } from '../config';
import { serializeActionsConfiguration } from '../actions_config';

const prepared: PreparedConnector = {
  actionId: 'connector',
  actionTypeId: '.jenkins',
  name: 'Jenkins',
  config: { baseUrl: 'http://127.0.0.1' },
  secrets: {},
  params: {},
  runtimeConfig: serializeActionsConfiguration(
    configSchema.validate({ allowedHosts: ['127.0.0.1'] })
  ),
};
const request = {
  connectorType: 'jenkins',
  connectorNameOrId: 'connector',
  input: {},
  system: false,
};
const services = { authTypes: [], isConnectorAuthorizationError };

it('finalizes cancellation after preparation rather than abandoning the original event continuation', async () => {
  const controller = new AbortController();
  const finalize = jest.fn(async () => {});
  const actions: NativeActionsApi = {
    prepare: async () => {
      controller.abort();
      return { prepared };
    },
    finalize,
  };
  const runtime = new SpecRuntime(actions);
  await expect(
    runtime.run(connectorsSpecs.Jenkins, services, 'scope', request, controller.signal)
  ).rejects.toThrow();
  expect(finalize).not.toHaveBeenCalled();
  await runtime.drain('scope');
  expect(finalize).toHaveBeenCalledWith('scope', [
    expect.objectContaining({
      runtime: expect.objectContaining({
        result: expect.objectContaining({ status: 'error', actionId: 'connector' }),
      }),
    }),
  ]);
  await runtime.close('scope');
  expect(finalize).toHaveBeenCalledTimes(1);
});

it('queues setup failures, preserves the original durable failure across drains and clears at close', async () => {
  const failure = new Error('bulk failed');
  const finalize = jest.fn(async () => {
    throw failure;
  });
  const actions: NativeActionsApi = {
    prepare: async () => ({
      prepared: {
        ...prepared,
        runtimeConfig: { ...prepared.runtimeConfig, maxResponseContentLength: 'invalid' },
      },
    }),
    finalize,
  };
  const runtime = new SpecRuntime(actions);
  await expect(runtime.run(connectorsSpecs.Jenkins, services, 'scope', request)).rejects.toThrow();
  await expect(runtime.drain('scope')).rejects.toBe(failure);
  await expect(runtime.drain('scope')).rejects.toBe(failure);
  await expect(runtime.close('scope')).rejects.toBe(failure);
  expect(finalize).toHaveBeenCalledTimes(1);
  await runtime.drain('scope');
  expect(finalize).toHaveBeenCalledTimes(1);
});

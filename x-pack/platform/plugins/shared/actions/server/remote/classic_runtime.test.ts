/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { configSchema } from '../config';
import { serializeActionsConfiguration } from '../actions_config';
import { SpecRuntime } from './spec_runtime_impl';
import type { ClassicConnectorType } from './classic_connector_types';
import type { NativeActionsApi, PreparedConnector } from './types';

const setup = () => {
  const prepared: PreparedConnector = {
    kibanaVersion: '9.7.0',
    actionId: 'saved',
    actionTypeId: '.classic',
    name: 'Classic',
    config: {},
    secrets: {},
    params: { text: 'marker' },
    runtimeConfig: serializeActionsConfiguration(
      configSchema.validate({ allowedHosts: ['127.0.0.1'] })
    ),
  };
  const actions: jest.Mocked<NativeActionsApi> = {
    prepare: jest.fn<
      ReturnType<NativeActionsApi['prepare']>,
      Parameters<NativeActionsApi['prepare']>
    >(async () => ({ prepared })),
    finalizeRetry: jest.fn().mockResolvedValue(undefined),
    finalize: jest.fn<
      ReturnType<NativeActionsApi['finalize']>,
      Parameters<NativeActionsApi['finalize']>
    >(async () => {}),
    dashboard: jest.fn(),
    relay: jest.fn(),
    token: jest.fn(),
  };
  const executor = jest.fn(async () => ({ status: 'ok' as const, actionId: 'saved', data: {} }));
  const validateParams = jest.fn();
  const connector: ClassicConnectorType<
    Record<string, never>,
    Record<string, never>,
    { text: string },
    object
  > = {
    id: '.classic',
    name: 'Classic',
    minimumLicenseRequired: 'gold',
    supportedFeatureIds: [],
    validate: {
      config: { schema: z.object({}) },
      secrets: { schema: z.object({}) },
      params: { schema: z.object({ text: z.string() }), customValidator: validateParams },
    },
    executor,
  };
  const create = jest.fn(() => connector);
  const runtime = new SpecRuntime(actions);
  const run = () =>
    runtime.runClassic('classic', create, 'scope', {
      connectorType: 'classic',
      connectorNameOrId: 'saved',
      system: false,
      input: prepared.params,
    });
  return { actions, prepared, executor, validateParams, connector, create, runtime, run };
};

it('runs original validators/executor and batches the same durable finalization with empty data intact', async () => {
  const { actions, executor, validateParams, create, runtime, run, prepared } = setup();
  await expect(run()).resolves.toEqual({ status: 'ok', actionId: 'saved', data: {} });
  await run();
  expect(create).toHaveBeenCalledWith(prepared);
  expect(validateParams).toHaveBeenCalledTimes(2);
  expect(executor).toHaveBeenCalledTimes(2);
  expect(actions.finalize).not.toHaveBeenCalled();
  await runtime.close('scope');
  expect(actions.finalize).toHaveBeenCalledTimes(1);
  expect(actions.finalize.mock.calls[0][1]).toHaveLength(2);
  expect(actions.finalize.mock.calls[0][1][0].runtime.handlerStarted).toBe(true);
});

it('keeps preflight refusals outside worker validation/handler/finalization', async () => {
  const { actions, create, runtime, run } = setup();
  actions.prepare.mockResolvedValue({
    result: { status: 'error', actionId: 'saved', message: 'denied' },
  });
  await expect(run()).resolves.toMatchObject({ status: 'error', message: 'denied' });
  await runtime.close('scope');
  expect(create).not.toHaveBeenCalled();
  expect(actions.finalize).not.toHaveBeenCalled();
});

it('preserves original validation refusal and leaves handlerStarted false for the reservation refund', async () => {
  const { actions, prepared, executor, runtime, run } = setup();
  actions.prepare.mockResolvedValue({ prepared: { ...prepared, params: {} } });
  await expect(run()).resolves.toMatchObject({ status: 'error', retry: false });
  expect(executor).not.toHaveBeenCalled();
  await runtime.close('scope');
  expect(actions.finalize.mock.calls[0][1][0].runtime).toMatchObject({
    handlerStarted: false,
    errorType: 'invalid',
  });
});

it('durably classifies factory errors without entering a handler', async () => {
  const { actions, create, runtime, run } = setup();
  create.mockImplementation(() => {
    throw new Error('factory failed');
  });
  await expect(run()).rejects.toThrow('factory failed');
  await runtime.close('scope');
  expect(actions.finalize.mock.calls[0][1][0].runtime).toMatchObject({
    handlerStarted: false,
    result: { status: 'error', retry: true },
  });
});

it('binds original token operations to the prepared invocation rather than supplied connector identifiers', async () => {
  const { actions, connector, create, runtime, run } = setup();
  actions.token.mockResolvedValue({ hasErrors: false, connectorToken: null });
  create.mockReturnValue({
    ...connector,
    executor: async ({ services }) => {
      await services.connectorTokenClient.get({ connectorId: 'ignored-worker-input' });
      return { status: 'ok', actionId: 'saved' };
    },
  });
  await run();
  expect(actions.token).toHaveBeenCalledWith('scope', expect.any(String), {
    operation: 'get',
    options: {},
  });
  await runtime.close('scope');
});

it('dispatches direct Actions by the authorized type and consumes preparation exactly once', async () => {
  const { actions, runtime, create, executor } = setup();
  await expect(
    runtime.runAction('scope', { actionId: 'saved', params: { text: 'marker' } }, (type, input) =>
      runtime.runClassic(type, create, 'scope', input)
    )
  ).resolves.toEqual({ status: 'ok', actionId: 'saved', data: {} });
  expect(actions.prepare).toHaveBeenCalledTimes(1);
  expect(actions.prepare).toHaveBeenCalledWith('scope', expect.any(String), {
    connectorNameOrId: 'saved',
    input: { text: 'marker' },
  });
  expect(executor).toHaveBeenCalledTimes(1);
  await runtime.close('scope');
  expect(actions.finalize.mock.calls[0][1][0].invocationId).toBe(actions.prepare.mock.calls[0][1]);
});

it('keeps direct non-Slack parameter validation errors identical to ordinary native execution', async () => {
  const normal = setup();
  const direct = setup();
  for (const { actions, prepared } of [normal, direct]) {
    actions.prepare.mockResolvedValue({ prepared: { ...prepared, params: {} } });
  }
  expect(
    await direct.runtime.runAction('scope', { actionId: 'saved', params: {} }, (type, input) =>
      direct.runtime.runClassic(type, direct.create, 'scope', input)
    )
  ).toEqual(await normal.run());
  expect(direct.executor).not.toHaveBeenCalled();
  await direct.runtime.close('scope');
  await normal.runtime.close('scope');
  expect(direct.actions.finalize.mock.calls[0][1][0].runtime.handlerStarted).toBe(false);
});

it.each([
  'missing connector',
  'unregistered type',
  'disabled type',
  'licence failure',
  'system action refusal',
])('preserves original direct prepare failure: %s', async (message) => {
  const { actions, runtime } = setup();
  const original = new Error(message);
  actions.prepare.mockRejectedValue(original);
  const dispatch = jest.fn();
  await expect(
    runtime.runAction('scope', { actionId: 'saved', params: {} }, dispatch)
  ).rejects.toBe(original);
  expect(dispatch).not.toHaveBeenCalled();
  await runtime.close('scope');
  expect(actions.finalize).not.toHaveBeenCalled();
});

it('returns original direct preconfigured preflight refusals without dispatching or reparing', async () => {
  const { actions, runtime } = setup();
  const result = {
    status: 'error' as const,
    actionId: 'preconfigured',
    message: 'original refusal',
  };
  actions.prepare.mockResolvedValue({ result });
  const dispatch = jest.fn();
  await expect(
    runtime.runAction('scope', { actionId: 'preconfigured', params: {} }, dispatch)
  ).resolves.toBe(result);
  expect(actions.prepare).toHaveBeenCalledTimes(1);
  expect(dispatch).not.toHaveBeenCalled();
});

it('rejects consuming a direct preparation from a different run before executor entry', async () => {
  const { runtime, create, executor } = setup();
  await expect(
    runtime.runAction('owner', { actionId: 'saved', params: { text: 'marker' } }, (type, input) =>
      runtime.runClassic(type, create, 'foreign', input)
    )
  ).rejects.toThrow('not owned by this run');
  expect(executor).not.toHaveBeenCalled();
  await runtime.close('owner');
});

it('safely finalizes an unconsumed direct dispatch error without copying private metadata', async () => {
  const { actions, runtime } = setup();
  const error = Object.assign(new TypeError('Unsupported native type'), {
    headers: { authorization: 'fake-private' },
    cause: { secret: 'fake-private' },
  });
  await expect(
    runtime.runAction('scope', { actionId: 'saved', params: {} }, async () => {
      throw error;
    })
  ).rejects.toBe(error);
  await runtime.close('scope');
  const saved = actions.finalize.mock.calls[0][1][0].runtime;
  expect(saved.handlerStarted).toBe(false);
  expect(JSON.stringify(saved)).not.toContain('fake-private');
});

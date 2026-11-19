/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { McpClient } from '@kbn/mcp-client';
import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { connectorsSpecs, isConnectorAuthorizationError } from '@kbn/connector-specs';
import { SpecRuntime } from './spec_runtime_impl';
import type { NativeActionsApi, PreparedConnector } from './types';
import { configSchema } from '../config';
import { serializeActionsConfiguration } from '../actions_config';

const prepared: PreparedConnector = {
  kibanaVersion: '9.7.0',
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
    dashboard: jest.fn(),
    relay: jest.fn(),
    token: jest.fn(),
    prepare: async () => {
      controller.abort();
      return { prepared };
    },
    finalizeRetry: finalize,
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

it('queues setup failures and surfaces unavailable finalization capabilities across retries and close', async () => {
  const failure = new Error('finalization capability unavailable');
  const finalize = jest.fn(async () => {
    throw failure;
  });
  const actions: NativeActionsApi = {
    dashboard: jest.fn(),
    relay: jest.fn(),
    token: jest.fn(),
    prepare: async () => ({
      prepared: {
        ...prepared,
        runtimeConfig: { ...prepared.runtimeConfig, maxResponseContentLength: 'invalid' },
      },
    }),
    finalizeRetry: finalize,
    finalize,
  };
  const runtime = new SpecRuntime(actions);
  await expect(runtime.run(connectorsSpecs.Jenkins, services, 'scope', request)).rejects.toThrow();
  await expect(runtime.drain('scope')).rejects.toBe(failure);
  await expect(runtime.drain('scope')).rejects.toBe(failure);
  await expect(runtime.close('scope')).rejects.toBe(failure);
  expect(finalize).toHaveBeenCalledTimes(4);
  await expect(runtime.drain('scope')).rejects.toBe(failure);
  expect(finalize).toHaveBeenCalledTimes(5);
});

it('runs spec getClient with the native registry and evicts each execution pool', async () => {
  const { clientTypes } = await import('@kbn/connector-specs/server');
  const native = new McpClient(loggingSystemMock.createLogger(), {
    url: 'http://127.0.0.1',
    name: 'native',
    version: '1',
  });
  const build = jest.spyOn(clientTypes.mcp, 'build').mockResolvedValue(native);
  const terminate = jest.spyOn(clientTypes.mcp, 'terminate').mockResolvedValue();
  const { z } = await import('@kbn/zod/v4');
  const spec = {
    ...connectorsSpecs.Jenkins,
    actions: {
      probe: {
        name: 'Probe',
        scope: 'read' as const,
        input: z.object({}),
        handler: async (ctx: import('@kbn/connector-specs').ActionContext) => {
          const client = await ctx.getClient('mcp');
          return { marker: client.name };
        },
      },
    },
  };
  const actions: NativeActionsApi = {
    dashboard: jest.fn(),
    relay: jest.fn(),
    token: jest.fn(),
    finalizeRetry: async () => {},
    finalize: jest.fn().mockResolvedValue(undefined),
    prepare: async () => ({
      prepared: {
        ...prepared,
        connectorVersion: '1',
        secrets: { authType: 'basic', username: 'user', password: 'pass' },
        params: { subAction: 'probe', subActionParams: {} },
      },
    }),
  };
  try {
    const runtime = new SpecRuntime(actions);
    for (let index = 0; index < 2; index++) {
      await expect(
        runtime.run(
          spec,
          {
            ...services,
            authTypes: [
              (
                await import('@kbn/connector-specs/server')
              ).authTypeSpecs.BasicAuth as import('@kbn/connector-specs').NormalizedAuthType,
            ],
          },
          'scope',
          request
        )
      ).resolves.toEqual({ status: 'ok', actionId: 'connector', data: { marker: 'native' } });
      expect(terminate).toHaveBeenCalledTimes(index + 1);
    }
    expect(build).toHaveBeenCalledTimes(2);
    await runtime.close('scope');
  } finally {
    build.mockRestore();
    terminate.mockRestore();
  }
});

it('retries failed finalization at drain and retains an unacknowledged batch after close failure', async () => {
  const failure = new Error('bulk failed');
  const finalize = jest.fn().mockRejectedValue(failure);
  const runtime = new SpecRuntime({
    dashboard: jest.fn(),
    relay: jest.fn(),
    token: jest.fn(),
    prepare: async () => ({
      prepared: {
        ...prepared,
        runtimeConfig: { ...prepared.runtimeConfig, maxResponseContentLength: 'invalid' },
      },
    }),
    finalizeRetry: finalize,
    finalize,
  });
  await expect(runtime.run(connectorsSpecs.Jenkins, services, 'scope', request)).rejects.toThrow();
  await expect(runtime.drain('scope')).rejects.toBe(failure);
  await expect(runtime.close('scope')).rejects.toBe(failure);
  finalize.mockResolvedValue(undefined);
  await runtime.drain('scope');
  await runtime.close('scope');
  expect(finalize).toHaveBeenCalledTimes(4);
});

it('discards raw runtime references before first finalization and retries using IDs only after teardown failure', async () => {
  const failure = Object.assign(new Error('provider failed'), {
    config: { headers: { Authorization: 'Bearer worker-only-secret' } },
  });
  const finalize = jest.fn().mockRejectedValue(new Error('bulk failed'));
  const finalizeRetry = jest.fn().mockRejectedValue(new Error('bulk still failed'));
  const runtime = new SpecRuntime({
    dashboard: jest.fn(),
    relay: jest.fn(),
    token: jest.fn(),
    prepare: async () => ({ prepared }),
    finalize,
    finalizeRetry,
  });
  await expect(
    runtime.runClassic(
      'jenkins',
      () => {
        throw failure;
      },
      'scope',
      request
    )
  ).rejects.toBe(failure);
  await expect(runtime.drain('scope')).rejects.toThrow('bulk still failed');
  expect(Reflect.get(runtime, 'pending').size).toBe(0);
  const batch = finalize.mock.calls[0][1];
  expect(Object.getOwnPropertyNames(batch[0].runtime.result.error).sort()).toEqual([
    'message',
    'name',
  ]);
  expect(JSON.stringify(batch)).not.toContain('worker-only-secret');
  const ids = batch.map(({ invocationId }: { invocationId: string }) => invocationId);
  await expect(runtime.close('scope')).rejects.toThrow('bulk still failed');
  expect(Reflect.get(runtime, 'pending').size).toBe(0);
  expect(Reflect.get(runtime, 'contexts').size).toBe(0);
  expect(finalizeRetry).toHaveBeenCalledWith('scope', ids);
  expect(JSON.stringify(finalizeRetry.mock.calls)).not.toContain('worker-only-secret');
  expect(finalize).toHaveBeenCalledTimes(1);
  finalizeRetry.mockResolvedValue(undefined);
  await runtime.drain('scope');
  expect(Reflect.get(runtime, 'retries').size).toBe(0);
});

it('drains the first failed persistence through exactly one ID-only retry before allowing completion', async () => {
  const finalize = jest.fn().mockRejectedValue(new Error('event index unavailable'));
  const finalizeRetry = jest.fn().mockResolvedValue(undefined);
  const runtime = new SpecRuntime({
    dashboard: jest.fn(),
    relay: jest.fn(),
    token: jest.fn(),
    prepare: async () => ({
      prepared: {
        ...prepared,
        runtimeConfig: { ...prepared.runtimeConfig, maxResponseContentLength: 'invalid' },
      },
    }),
    finalize,
    finalizeRetry,
  });
  await expect(runtime.run(connectorsSpecs.Jenkins, services, 'scope', request)).rejects.toThrow();
  await runtime.drain('scope');
  await runtime.close('scope');
  expect(finalize).toHaveBeenCalledTimes(1);
  expect(finalizeRetry).toHaveBeenCalledTimes(1);
  expect(finalizeRetry.mock.calls[0][1]).toEqual(
    finalize.mock.calls[0][1].map(({ invocationId }: { invocationId: string }) => invocationId)
  );
  expect(Reflect.get(runtime, 'pending').size).toBe(0);
  expect(Reflect.get(runtime, 'retries').size).toBe(0);
});

it.each([false, true])(
  'flushes new results alongside older retries, including during close (active=%s)',
  async (active) => {
    const finalize = jest
      .fn()
      .mockRejectedValueOnce(new Error('bulk failed'))
      .mockResolvedValue(undefined);
    const finalizeRetry = jest
      .fn()
      .mockRejectedValueOnce(new Error('retry failed'))
      .mockResolvedValue(undefined);
    const runtime = new SpecRuntime({
      dashboard: jest.fn(),
      relay: jest.fn(),
      token: jest.fn(),
      prepare: async () => ({
        prepared: {
          ...prepared,
          runtimeConfig: { ...prepared.runtimeConfig, maxResponseContentLength: 'invalid' },
        },
      }),
      finalize,
      finalizeRetry,
    });
    const queue = () =>
      expect(runtime.run(connectorsSpecs.Jenkins, services, 'scope', request)).rejects.toThrow();
    await queue();
    await expect(runtime.drain('scope')).rejects.toThrow('retry failed');
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    if (active)
      finalizeRetry.mockImplementationOnce(async () => {
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      });
    const draining = active ? runtime.drain('scope') : undefined;
    if (active) await ready;
    await queue();
    const closing = runtime.close('scope');
    release();
    await Promise.all([draining, closing]);
    expect(finalize).toHaveBeenCalledTimes(2);
    expect(finalizeRetry).toHaveBeenCalledTimes(2);
    expect(finalize.mock.calls[0][1][0].invocationId).not.toBe(
      finalize.mock.calls[1][1][0].invocationId
    );
    expect(Reflect.get(runtime, 'pending').size).toBe(0);
    expect(Reflect.get(runtime, 'retries').size).toBe(0);
  }
);

it('does not finish close until results queued during the active drain are acknowledged', async () => {
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const firstEntered = Promise.withResolvers<void>();
  const secondEntered = Promise.withResolvers<void>();
  const finalize = jest
    .fn()
    .mockImplementationOnce(async () => {
      firstEntered.resolve();
      await first.promise;
    })
    .mockImplementationOnce(async () => {
      secondEntered.resolve();
      await second.promise;
    });
  const runtime = new SpecRuntime({
    dashboard: jest.fn(),
    relay: jest.fn(),
    token: jest.fn(),
    prepare: async () => ({
      prepared: {
        ...prepared,
        runtimeConfig: { ...prepared.runtimeConfig, maxResponseContentLength: 'invalid' },
      },
    }),
    finalize,
    finalizeRetry: jest.fn(),
  });
  const queue = () =>
    expect(runtime.run(connectorsSpecs.Jenkins, services, 'scope', request)).rejects.toThrow();
  await queue();
  const draining = runtime.drain('scope');
  await firstEntered.promise;
  await queue();
  let closed = false;
  const closing = runtime.close('scope').then(() => {
    closed = true;
  });
  first.resolve();
  await secondEntered.promise;
  expect(closed).toBe(false);
  second.resolve();
  await Promise.all([draining, closing]);
  expect(closed).toBe(true);
  expect(finalize).toHaveBeenCalledTimes(2);
});

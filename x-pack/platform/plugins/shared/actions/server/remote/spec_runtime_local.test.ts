/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { Readable } from 'node:stream';
import { z } from '@kbn/zod/v4';
import type { SubActionConnectorType, SubActionServices } from '../sub_action_framework/types';
import { configSchema } from '../config';
import { serializeActionsConfiguration } from '../actions_config';
import { SpecRuntime } from './spec_runtime_impl';
import type { NativeActionsApi } from './types';

const mockExecute = jest.fn();
jest.mock('../sub_action_framework/executor', () => ({ buildExecutor: () => mockExecute }));
const connector: SubActionConnectorType<{}, {}, SubActionServices> = {
  id: '.gen-ai',
  name: 'Original local inference',
  minimumLicenseRequired: 'enterprise',
  supportedFeatureIds: [],
  schema: { config: z.object({}), secrets: z.object({}) },
  getService: () => {
    throw new Error('Executor mock owns service invocation');
  },
};
const request = {
  connectorType: '.gen-ai',
  connectorNameOrId: 'connector',
  system: false,
  input: { subAction: 'stream', subActionParams: { body: '{"messages":[]}' } },
};
const services = { scopedClusterClient: {} as SubActionServices['scopedClusterClient'] };

it('completion drain waits for original local stream finalization and the durable finalizer exactly once', async () => {
  const source = Readable.from([
    'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\ndata: [DONE]\n\n',
  ]);
  mockExecute.mockResolvedValue({ status: 'ok', actionId: 'connector', data: source });
  let release = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finalize = jest.fn(() => barrier);
  const actions: NativeActionsApi = {
    dashboard: jest.fn(),
    token: jest.fn(),
    relay: jest.fn(),
    finalize,
    prepare: async () => ({
      prepared: {
        kibanaVersion: '9.7.0',
        actionId: 'connector',
        actionTypeId: '.gen-ai',
        name: 'Local',
        config: {},
        secrets: {},
        params: request.input,
        runtimeConfig: serializeActionsConfiguration(configSchema.validate({})),
      },
    }),
  };
  const runtime = new SpecRuntime(actions);
  const execution = await runtime.runLocal(connector, services, 'scope', request);
  const stream = execution.result.data;
  if (!(stream instanceof Readable)) throw new Error('Expected live stream');
  for await (const chunk of stream) void chunk;
  let completed = false;
  const draining = runtime.drain('scope').then(() => {
    completed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(finalize).toHaveBeenCalledTimes(1);
  expect(completed).toBe(false);
  expect(finalize).toHaveBeenCalledWith('scope', [
    expect.objectContaining({
      runtime: expect.objectContaining({
        genAiTokenTracking: expect.objectContaining({ total_tokens: 1 }),
      }),
    }),
  ]);
  release();
  await draining;
  await execution.finalize();
  await runtime.close('scope');
  expect(finalize).toHaveBeenCalledTimes(1);
});

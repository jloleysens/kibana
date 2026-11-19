/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createToken } from '@kbn/core-di';
import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { RemoteService } from '@kbn/core-remote-server-internal';
import type { NativeActionsApi } from '@kbn/actions-plugin/server/remote/types';
import { configSchema } from '@kbn/actions-plugin/server/config';
import { serializeActionsConfiguration } from '@kbn/actions-plugin/server/actions_config';
import { buildRemoteBundle } from '../build';

class ScopedActions {
  constructor(private readonly api: NativeActionsApi) {}
  prepare(...args: Parameters<NativeActionsApi['prepare']>) {
    return this.api.prepare(...args);
  }
  finalize(...args: Parameters<NativeActionsApi['finalize']>) {
    return this.api.finalize(...args);
  }
}

it.each(['in_process', 'child_process'] as const)(
  '%s consumes live original inference adapter streams locally and drains original usage',
  async (backend) => {
    const directory = mkdtempSync(join(tmpdir(), 'local-inference-stream-'));
    const plugin = resolve(__dirname, '../__fixtures__/local_inference');
    const service = new RemoteService(loggingSystemMock.createLogger(), {
      maxOldGenerationSizeMb: 256,
      bundleDirectory: directory,
    });
    const streams: boolean[] = [];
    const fake = createServer(async (request, response) => {
      let text = '';
      for await (const chunk of request) text += chunk;
      response.setHeader('x-elastic-product', 'Elasticsearch');
      if (request.method === 'GET') {
        response.setHeader('content-type', 'application/json');
        response.end('{"endpoints":[]}');
        return;
      }
      streams.push(JSON.parse(text).stream);
      response.setHeader('content-type', 'text/event-stream');
      response.end(
        'data: {"id":"local","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"live-native-marker"},"finish_reason":null}]}\n\ndata: {"id":"local","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":6,"total_tokens":18}}\n\ndata: [DONE]\n\n'
      );
    });
    try {
      await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done));
      const address = fake.address();
      if (!address || typeof address === 'string') throw new Error('No fake address');
      const node = `http://127.0.0.1:${address.port}`;
      await buildRemoteBundle({
        manifests: [join(plugin, 'server/remote/index.ts')],
        graph: {
          contributions: [],
          id: 'stream',
          root: 'laneB.streamProbe',
          dependencies: ['actions.specRuntime'],
        },
        outdir: join(directory, 'stream'),
      });
      service.discover([plugin]);
      service.register({
        contributions: [],
        id: 'stream',
        root: createToken('laneB.streamProbe'),
        dependencies: [createToken('actions.specRuntime')],
      });
      const finalize = jest.fn<
        ReturnType<NativeActionsApi['finalize']>,
        Parameters<NativeActionsApi['finalize']>
      >(async () => {});
      const actions: NativeActionsApi = {
        finalizeRetry: jest.fn(async () => {}),
        dashboard: jest.fn(),
        token: jest.fn(),
        relay: jest.fn(),
        finalize,
        prepare: async (_scope, _invocation, request) => ({
          prepared: {
            kibanaVersion: '9.7.0',
            actionId: 'legacy',
            actionTypeId: '.gen-ai',
            name: 'Local',
            params: request.input,
            config: { apiProvider: 'OpenAI', apiUrl: node, defaultModel: 'gpt-4o' },
            secrets: { apiKey: 'fake' },
            runtimeConfig: serializeActionsConfiguration(
              configSchema.validate({ allowedHosts: ['127.0.0.1'] })
            ),
          },
        }),
      };
      service.bind(createToken('actions.native'), () => new ScopedActions(actions));
      await service.start(backend);
      const lease = await service.lease<{
        run(scope: string, node: string): Promise<{ content: string; pid: number }>;
      }>('stream');
      const scope = lease.openScope({});
      const result = await lease.stub.run(scope, node);
      expect(result.content).toBe('live-native-marker');
      expect(result.pid === process.pid).toBe(backend === 'in_process');
      expect(streams).toEqual([true]);
      expect(finalize).toHaveBeenCalledTimes(1);
      expect(finalize.mock.calls[0][1][0].runtime.genAiTokenTracking).toEqual(
        expect.objectContaining({
          total_tokens: expect.any(Number),
          prompt_tokens: expect.any(Number),
          completion_tokens: expect.any(Number),
        })
      );
      await lease.release();
    } finally {
      await service.stop();
      fake.closeAllConnections();
      await new Promise<void>((done) => fake.close(() => done()));
      rmSync(directory, { recursive: true, force: true });
    }
  },
  60_000
);

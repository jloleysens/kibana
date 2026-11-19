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
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License, v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@elastic/elasticsearch';
import { configSchema } from '@kbn/actions-plugin/server/config';
import { serializeActionsConfiguration } from '@kbn/actions-plugin/server/actions_config';
import type { Metafile } from 'esbuild';
import type { RemoteWorkerSpec } from '@kbn/core-remote-common';
import type { NativeActionsApi, PreparedConnector } from '@kbn/actions-plugin/server/remote/types';
import type { SpecRuntime } from '@kbn/actions-plugin/server/remote/spec_runtime';

interface Graph {
  spec: RemoteWorkerSpec;
  implementations: Record<string, () => Promise<Record<string, new (...args: never[]) => object>>>;
}
interface Connector {
  run(scopeId: string, input: object, context: object): Promise<{ status: string; data: object }>;
}

const main = async (): Promise<void> => {
  const directory = resolve(process.argv[2]);
  const graph: Graph = await import(pathToFileURL(join(directory, 'graph.mjs')).href);
  const metadata: Metafile = JSON.parse(readFileSync(join(directory, 'metafile.json'), 'utf8'));
  const marker = 'legacy-native-network-marker';
  let requests = 0;
  const server = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    requests++;
    response.writeHead(200, {
      'content-type': 'application/json',
      'x-elastic-product': 'Elasticsearch',
    });
    response.end(
      JSON.stringify(
        request.url?.includes('/_inference/')
          ? { completion: [{ result: marker }] }
          : request.url?.includes(':generateContent')
          ? {
              candidates: [{ content: { parts: [{ text: marker }] } }],
              usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
            }
          : request.url?.includes('/model/')
          ? {
              completion: marker,
              stop_reason: 'end_turn',
              usage: { input_tokens: 1, output_tokens: 1 },
            }
          : {
              choices: [{ message: { role: 'assistant', content: marker } }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }
      )
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const client = new Client({ node: url });
  const shell = graph.spec.executorProviders.find(
    ({ tokenId }) => tokenId === 'actions.specRuntime'
  );
  assert(shell);
  for (const root of [
    graph.spec.root,
    ...graph.spec.executorProviders.filter((provider) => provider !== shell),
    graph.spec.catalog,
  ])
    if (root) await graph.implementations[root.modulePath]();
  for (const suffix of [
    '/remote/spec_runtime_impl.ts',
    '/openai/openai_sdk.ts',
    '/bedrock/bedrock_sdk.ts',
    '/lib/google_auth_sdk.ts',
    '/token_tracking/gen_ai_token_tracking.ts',
  ]) {
    const module = Object.entries(metadata.outputs).find(([, output]) =>
      output.entryPoint?.endsWith(suffix)
    );
    assert(module);
    await import(pathToFileURL(resolve(module[0])).href);
  }
  const sample = () => {
    assert(global.gc);
    global.gc();
    return process.memoryUsage();
  };
  const cases = [
    {
      type: 'gen-ai',
      operation: 'run',
      config: { apiUrl: url + '/v1/chat/completions', apiProvider: 'Other', defaultModel: 'fake' },
      secrets: { apiKey: 'fake' },
      params: { body: JSON.stringify({ messages: [{ role: 'user', content: 'marker' }] }) },
    },
    {
      type: 'bedrock',
      operation: 'run',
      config: { apiUrl: url, defaultModel: 'fake', region: 'us-east-1' },
      secrets: { accessKey: 'fake', secret: 'fake' },
      params: { body: JSON.stringify({ prompt: 'marker', max_tokens_to_sample: 10 }) },
    },
    {
      type: 'gemini',
      operation: 'run',
      config: { apiUrl: url, defaultModel: 'fake', gcpRegion: 'fake', gcpProjectID: 'fake' },
      secrets: { credentialsJson: JSON.stringify({ type: 'service_account' }) },
      params: { body: JSON.stringify({ contents: [] }) },
    },
    {
      type: 'inference',
      operation: 'completion',
      config: {
        provider: 'openai',
        inferenceId: 'fake',
        taskType: 'completion',
        providerConfig: {},
      },
      secrets: { providerSecrets: {} },
      params: { input: 'marker' },
    },
  ];
  let prepared: PreparedConnector;
  const results: object[] = [];
  let prepares = 0;
  let finalized = 0;
  const actions: NativeActionsApi = {
    prepare: async () => {
      prepares++;
      return { prepared };
    },
    finalizeRetry: async () => {},
    finalize: async (_scope, finalizations) => {
      finalized += finalizations.length;
    },
    relay: async () => ({ error: {} }),
    dashboard: async () => ({
      error: { message: 'not part of network fixture', statusCode: 403, error: 'Forbidden' },
    }),
    token: async () => ({
      hasErrors: false,
      connectorToken: {
        id: 'cached-fake-token',
        connectorId: 'fake',
        token: 'fake',
        tokenType: 'access_token',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
    }),
  };
  const runtimeModule = await graph.implementations[shell.modulePath]();
  const Runtime = runtimeModule[shell.exportName] as new (actions: NativeActionsApi) => SpecRuntime;
  const runtime = new Runtime(actions);
  try {
    for (const test of cases) {
      const contribution = graph.spec.contributions.find(({ stepType }) => stepType === test.type);
      assert(contribution);
      const before = sample();
      const start = performance.now();
      const count = requests;
      const loaded = await graph.implementations[contribution.modulePath]();
      const Constructor = loaded[contribution.exportName] as new (
        runtime: SpecRuntime,
        data: { user(): Client }
      ) => Connector;
      prepared = {
        kibanaVersion: '9.7.0',
        actionId: 'fake',
        actionTypeId: '.' + test.type,
        name: test.type,
        config: test.config,
        secrets: test.secrets,
        params: { subAction: test.operation, subActionParams: test.params },
        runtimeConfig: serializeActionsConfiguration(
          configSchema.validate({ allowedHosts: ['127.0.0.1'] })
        ),
      };
      const result = await new Constructor(runtime, { user: () => client }).run(
        'scope',
        {
          connectorType: test.type,
          connectorNameOrId: 'fake',
          system: false,
          input: prepared.params,
        },
        {}
      );
      assert.equal(result.status, 'ok', JSON.stringify(result));
      assert(JSON.stringify(result.data).includes(marker));
      const ms = performance.now() - start;
      await new Promise<void>((done) => setImmediate(done));
      const after = sample();
      results.push({
        type: test.type,
        ms,
        heapIncrement: after.heapUsed - before.heapUsed,
        requests: requests - count,
        before,
        after,
      });
    }
    await runtime.drain('scope');
    assert.equal(prepares, 4);
    assert.equal(finalized, 4);
    process.stdout.write(JSON.stringify({ pid: process.pid, results, prepares, finalized }));
  } finally {
    await runtime.close('scope');
    await client.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
};
void main().catch((error: Error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});

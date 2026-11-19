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

import { legacyConnectorCases, legacyConnectorResponse } from './legacy_connector_cases';

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
  const marker = 'local-business';
  let requests = 0;
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    requests++;
    response.writeHead(200, {
      'content-type': 'application/json',
      'x-elastic-product': 'Elasticsearch',
    });
    const body = legacyConnectorResponse(request, text);
    assert(body, request.url);
    response.end(JSON.stringify(body));
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
  const cases = legacyConnectorCases(url);
  let prepared: PreparedConnector;
  const results: object[] = [];
  let prepares = 0;
  let finalized = 0;
  const actions: NativeActionsApi = {
    prepare: async () => {
      prepares++;
      return { prepared };
    },
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
        params: test.op ? { subAction: test.op, subActionParams: test.params } : test.params,
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
      if (test.type === 'thehive') assert.deepEqual(result.data, {});
      else if (test.type === 'resilient') assert.equal('id' in result.data && result.data.id, '17');
      else assert(JSON.stringify(result.data).includes(marker), JSON.stringify(result));
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
    assert.equal(prepares, cases.length);
    assert.equal(finalized, cases.length);
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

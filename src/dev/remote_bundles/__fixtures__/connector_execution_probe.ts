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

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Metafile } from 'esbuild';
import type { SpecRuntimeApi } from '@kbn/connector-specs';
import type { NativeActionsApi } from '@kbn/actions-plugin/server';
import type { RemoteWorkerSpec } from '@kbn/core-remote-common';

interface Connector {
  run(scopeId: string, input: object, context: object): Promise<object>;
}
interface Graph {
  spec: RemoteWorkerSpec;
  implementations: Record<string, () => Promise<Record<string, new (...args: never[]) => object>>>;
}

const main = async (): Promise<void> => {
  assert.equal(typeof global.gc, 'function');
  const directory = resolve(process.argv[2]);
  const graph: Graph = await import(pathToFileURL(join(directory, 'graph.mjs')).href);
  const metadata: Metafile = JSON.parse(readFileSync(join(directory, 'metafile.json'), 'utf8'));
  const samples: Array<{ phase: string; rss: number; heapUsed: number }> = [];
  const sample = async (phase: string) => {
    await new Promise<void>((done) => setImmediate(done));
    global.gc?.();
    const { rss, heapUsed } = process.memoryUsage();
    samples.push({ phase, rss, heapUsed });
  };
  const shell = graph.spec.executorProviders.find(
    ({ tokenId }) => tokenId === 'actions.specRuntime'
  );
  const contribution = graph.spec.contributions.find(({ stepType }) => stepType === 'jenkins');
  assert(shell && contribution);
  for (const root of [
    graph.spec.root,
    ...graph.spec.executorProviders.filter((provider) => provider !== shell),
    graph.spec.catalog,
  ]) {
    if (root) await graph.implementations[root.modulePath]();
  }
  await sample('engine_core');
  const { SpecRuntime } = (await graph.implementations[shell.modulePath]()) as {
    SpecRuntime: new (actions: NativeActionsApi) => SpecRuntimeApi;
  };
  await sample('shell');
  const shared = Object.entries(metadata.outputs).find(([, value]) =>
    value.entryPoint?.endsWith('/remote/spec_runtime_impl.ts')
  );
  assert(shared);
  const sharedStarted = performance.now();
  await import(pathToFileURL(resolve(shared[0])).href);
  const sharedImportMs = performance.now() - sharedStarted;
  await sample('shared_module_import');

  let requests = 0;
  const fake = createServer(async (request, response) => {
    for await (const chunk of request) assert(chunk);
    requests++;
    assert.equal(
      request.headers.authorization,
      `Basic ${Buffer.from('fake:fake').toString('base64')}`
    );
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ persisted: requests }));
  });
  await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done));
  const address = fake.address();
  assert(address && typeof address !== 'string');
  const prepares: string[] = [];
  const finalizes: number[] = [];
  const actions: NativeActionsApi = {
    token: async () => ({ hasErrors: false, connectorToken: null }),
    prepare: async (_scopeId, invocationId, request) => {
      prepares.push(invocationId);
      return {
        prepared: {
          kibanaVersion: '9.7.0',
          actionId: 'fake',
          actionTypeId: '.jenkins',
          name: 'Jenkins',
          config: { baseUrl: `http://127.0.0.1:${address.port}`, selectedActions: ['request'] },
          secrets: { authType: 'basic', username: 'fake', password: 'fake' },
          params: request.input,
          runtimeConfig: {
            allowedHosts: ['127.0.0.1'],
            enabledActionTypes: ['*'],
            ssl: { verificationMode: 'full', proxyVerificationMode: 'full' },
            proxyUrl: undefined,
            proxyBypassHosts: undefined,
            proxyOnlyHosts: undefined,
            proxyHeaders: undefined,
            customHostSettings: undefined,
            webhook: { ssl: { pfx: { enabled: true } } },
            auth: {
              oauth_authorization_code: {
                rate_limits: {
                  authorize: { limit: 100, lookbackWindow: '1h' },
                  callback: { limit: 100, lookbackWindow: '1h' },
                },
              },
              ears: { enabled: false, enableExperimental: false, url: undefined, ssl: undefined },
            },
            responseTimeout: 10000,
            maxResponseContentLength: '1048576b',
          },
        },
      };
    },
    finalize: async (_scopeId, results) => {
      finalizes.push(results.length);
    },
  };
  const runtime = new SpecRuntime(actions);
  try {
    const typeStarted = performance.now();
    const { JenkinsConnector } = (await graph.implementations[contribution.modulePath]()) as {
      JenkinsConnector: new (service: SpecRuntimeApi) => Connector;
    };
    const typeImportMs = performance.now() - typeStarted;
    const connector = new JenkinsConnector(runtime);
    const times = [];
    for (let index = 0; index < 2; index++) {
      const started = performance.now();
      const result = await connector.run(
        'scope',
        {
          connectorType: 'jenkins',
          connectorNameOrId: 'fake',
          system: false,
          input: {
            subAction: 'request',
            subActionParams: { method: 'POST', path: '/business', body: { index } },
          },
        },
        {}
      );
      times.push(performance.now() - started);
      assert.deepEqual(result, { actionId: 'fake', status: 'ok', data: { persisted: index + 1 } });
      await sample(index === 0 ? 'type_and_first_execution' : 'warm_execution');
    }
    assert.equal(finalizes.length, 0);
    await runtime.close('scope');
    assert.deepEqual(finalizes, [2]);
    await sample('drained');
    process.stdout.write(
      JSON.stringify({
        pid: process.pid,
        gcAvailable: true,
        fakePort: address.port,
        samples,
        sharedImportMs,
        typeImportMs,
        executionMs: times,
        prepares: prepares.length,
        finalizes,
        requests,
      })
    );
  } finally {
    await new Promise<void>((done, reject) =>
      fake.close((error) => (error ? reject(error) : done()))
    );
  }
};

main().catch((error: Error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});

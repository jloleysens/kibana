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
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Duplex } from 'node:stream';
import { execFileSync } from 'node:child_process';

import type { Metafile } from 'esbuild';
import type { SpecRuntimeApi } from '@kbn/connector-specs';
import type { NativeActionsApi } from '@kbn/actions-plugin/server';
import type { RemoteWorkerSpec } from '@kbn/core-remote-common';
interface Graph {
  spec: RemoteWorkerSpec;
  implementations: Record<string, () => Promise<Record<string, new (...args: never[]) => object>>>;
}
interface Connector {
  run(scopeId: string, input: object, context: object): Promise<{ status: string }>;
}
interface Sample extends NodeJS.MemoryUsage {
  phase: string;
}
interface Case {
  type: string;
  op: string;
  config: Record<string, string>;
  secrets: Record<string, string>;
  params?: Record<string, string>;
}

const main = async (): Promise<void> => {
  const directory = resolve(process.argv[2]);
  const graph: Graph = await import(pathToFileURL(join(directory, 'graph.mjs')).href);
  const metadata: Metafile = JSON.parse(readFileSync(join(directory, 'metafile.json'), 'utf8'));
  const samples: Sample[] = [];
  const sample = async (phase: string) => {
    await new Promise<void>((r) => setImmediate(r));
    assert(global.gc);
    global.gc();
    samples.push({ phase, ...process.memoryUsage() });
  };
  const shell = graph.spec.executorProviders.find((p) => p.tokenId === 'actions.specRuntime');
  assert(shell);
  for (const root of [
    graph.spec.root,
    ...graph.spec.executorProviders.filter((p) => p !== shell),
    graph.spec.catalog,
  ])
    if (root) await graph.implementations[root.modulePath]();
  await sample('engine_core');
  assert(shell);
  const { SpecRuntime } = (await graph.implementations[shell.modulePath]()) as {
    SpecRuntime: new (actions: NativeActionsApi) => SpecRuntimeApi;
  };
  await sample('shell');
  const shared = Object.entries(metadata.outputs).find(([, v]) =>
    v.entryPoint?.endsWith('/remote/spec_runtime_impl.ts')
  );
  assert(shared);
  let time = performance.now();
  await import(pathToFileURL(resolve(shared[0])).href);
  const sharedMs = performance.now() - time;
  await sample('shared_actions_module');
  const mcp = Object.entries(metadata.outputs).find(([, v]) =>
    Object.keys(v.inputs).some((p) => p.endsWith('/lib/mcp/with_mcp_client.ts'))
  );
  assert(mcp);
  time = performance.now();
  await import(pathToFileURL(resolve(mcp[0])).href);
  const mcpMs = performance.now() - time;
  await sample('shared_mcp_module');
  const temp = mkdtempSync(join(tmpdir(), 'connector-type-fake-'));
  const domains = [
    'api.rootly.com',
    'api.datadoghq.com',
    'api.newrelic.com',
    'api.platform.censys.io',
  ];
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(temp, 'key.pem'),
      '-out',
      join(temp, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=connector-local-fake',
      '-addext',
      'subjectAltName=' + domains.map((d) => 'DNS:' + d).join(','),
    ],
    { stdio: 'ignore' }
  );
  let requests = 0;
  const seen: Array<{ host?: string; path?: string }> = [];
  const serve = async (req: IncomingMessage, res: ServerResponse) => {
    let text = '';
    for await (const c of req) text += c;
    requests++;
    seen.push({ host: req.headers.host, path: req.url });
    let body: object = { marker: 'local-business', data: [] };
    if (req.url?.includes('/organizations/fake/issues/'))
      body = [{ id: 'fake', marker: 'local-business' }];
    if (req.headers.host === 'api.rootly.com')
      body = { data: [{ id: 'local-business', attributes: { marker: 'local-business' } }] };
    if (req.headers.host === 'api.newrelic.com')
      body = {
        data: { actor: { account: { alerts: { mutingRules: [{ marker: 'local-business' }] } } } },
      };
    if (req.url?.startsWith('/mcp')) {
      const rpc: { id?: number; method?: string } = text ? JSON.parse(text) : {};
      if (!('id' in rpc)) {
        res.writeHead(202);
        res.end();
        return;
      }
      const result =
        rpc.method === 'initialize'
          ? {
              protocolVersion: '2025-03-26',
              capabilities: { tools: {} },
              serverInfo: { name: 'local-fake', version: '1' },
            }
          : rpc.method === 'tools/list'
          ? { tools: [] }
          : { content: [{ type: 'text', text: JSON.stringify({ marker: 'local-business' }) }] };
      body = { jsonrpc: '2.0', id: rpc.id, result };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const fake = createServer(serve);
  const tlsFake = createHttpsServer(
    { key: readFileSync(join(temp, 'key.pem')), cert: readFileSync(join(temp, 'cert.pem')) },
    serve
  );
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => tlsFake.listen(0, '127.0.0.1', r));
  const sockets = new Set<Duplex>();
  const proxy = createServer();
  proxy.on('connect', (req, socket, head) => {
    assert(req.url);
    assert(domains.includes(req.url.split(':')[0]));
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const upstream = connect(port(tlsFake), '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on('error', (e) => socket.destroy(e));
    socket.on('error', () => upstream.destroy());
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  const port = (server: ReturnType<typeof createServer>): number => {
    const address = server.address();
    assert(address && typeof address !== 'string');
    return address.port;
  };
  const url = `http://127.0.0.1:${port(fake)}`;
  const bearer = { authType: 'bearer', token: 'fake-token' };
  const basic = { authType: 'basic', username: 'fake', password: 'fake' };
  const cases: Case[] = [
    {
      type: 'jenkins',
      op: 'request',
      config: { baseUrl: url },
      secrets: basic,
      params: { method: 'POST', path: '/business' },
    },
    { type: 'rootly', op: 'listSeverities', config: {}, secrets: bearer },
    {
      type: 'unifi',
      op: 'getNetworkInfo',
      config: { consoleUrl: url },
      secrets: { authType: 'api_key_header', 'X-API-KEY': 'fake-key' },
    },
    {
      type: 'buildkite',
      op: 'listTools',
      config: { serverUrl: url + '/mcp', orgSlug: 'fake' },
      secrets: bearer,
    },
    {
      type: 'dynatrace',
      op: 'listProblems',
      config: { environmentUrl: url },
      secrets: { authType: 'api_key_header', apiToken: 'fake-key' },
    },
    { type: 'grafana', op: 'listRules', config: { baseUrl: url }, secrets: bearer },
    {
      type: 'new_relic',
      op: 'listMutingRules',
      config: { accountId: '1', region: 'us' },
      secrets: { authType: 'api_key_header', 'API-Key': 'fake-key' },
    },
    { type: 'prometheus', op: 'getStatus', config: { baseUrl: url }, secrets: basic },
    {
      type: 'sentry',
      op: 'listIssues',
      config: { baseUrl: url, organizationSlug: 'fake' },
      secrets: bearer,
    },
    { type: 'datadog', op: 'listMonitors', config: { site: 'datadoghq.com' }, secrets: basic },
    {
      type: 'censys',
      op: 'getHost',
      config: { organizationId: '00000000-0000-4000-a000-000000000001' },
      secrets: bearer,
      params: { host: '1.1.1.1' },
    },
    {
      type: 'pagerduty_mcp',
      op: 'listTools',
      config: { serverUrl: url + '/mcp' },
      secrets: { authType: 'api_key_header', Authorization: 'Token token=fake-key' },
    },
  ];
  let current = cases[0];
  let prepares = 0;
  const finalizes: number[] = [];
  const actions: NativeActionsApi = {
    prepare: async (_s, invocationId, request) => {
      prepares++;
      return {
        prepared: {
          kibanaVersion: '9.7.0',
          actionId: current.type,
          actionTypeId: '.' + current.type,
          name: current.type,
          config: { ...current.config, selectedActions: [current.op] },
          secrets: current.secrets,
          params: request.input,
          runtimeConfig: {
            allowedHosts: ['127.0.0.1', ...domains],
            enabledActionTypes: ['*'],
            ssl: { verificationMode: 'full', proxyVerificationMode: 'full' },
            proxyUrl: `http://127.0.0.1:${port(proxy)}`,
            proxyBypassHosts: ['127.0.0.1'],
            customHostSettings: domains.map((d) => ({
              url: 'https://' + d + ':443',
              ssl: {
                verificationMode: 'full',
                certificateAuthoritiesData: readFileSync(join(temp, 'cert.pem'), 'utf8'),
              },
            })),
            webhook: { ssl: { pfx: { enabled: true } } },
            auth: {
              oauth_authorization_code: {
                rate_limits: {
                  authorize: { limit: 100, lookbackWindow: '1h' },
                  callback: { limit: 100, lookbackWindow: '1h' },
                },
              },
              ears: { enabled: false, enableExperimental: false },
            },
            responseTimeout: 10000,
            maxResponseContentLength: '1048576b',
          },
        },
      };
    },
    finalize: async (_s, results) => {
      finalizes.push(results.length);
    },
  };
  const runtime = new SpecRuntime(actions);
  const events: Array<{
    type: string;
    operation: string;
    ms: number;
    heapIncrement: number;
    requests: number;
  }> = [];
  try {
    await sample('fake_setup');
    for (const entry of cases) {
      current = entry;
      const contribution = graph.spec.contributions.find((c) => c.stepType === entry.type);
      assert(contribution);
      const before = samples[samples.length - 1];
      const started = performance.now();
      const mod = await graph.implementations[contribution.modulePath]();
      const klass = mod[contribution.exportName] as new (service: SpecRuntimeApi) => Connector;
      assert(klass);
      const connector = new klass(runtime);
      const beforeRequests = requests;
      const result = await connector.run(
        'scope',
        {
          connectorType: entry.type,
          connectorNameOrId: entry.type,
          system: false,
          input: { subAction: entry.op, subActionParams: entry.params ?? {} },
        },
        {}
      );
      assert.equal(result.status, 'ok', JSON.stringify({ type: entry.type, result }));
      assert(requests > beforeRequests, entry.type + ' did not reach fake');
      await sample(entry.type);
      events.push({
        type: entry.type,
        operation: entry.op,
        ms: performance.now() - started,
        heapIncrement: samples[samples.length - 1].heapUsed - before.heapUsed,
        requests: requests - beforeRequests,
      });
    }
    await runtime.close('scope');
    await sample('closed');
    process.stdout.write(
      JSON.stringify({
        pid: process.pid,
        samples,
        events,
        sharedMs,
        mcpMs,
        prepares,
        finalizes,
        requests,
        seen,
      })
    );
  } finally {
    for (const s of sockets) s.destroy();
    fake.closeAllConnections();
    tlsFake.closeAllConnections();
    await Promise.all(
      [fake, tlsFake, proxy].map(
        (s) =>
          new Promise<void>((r) =>
            s.close((error) => {
              if (error) throw error;
              r();
            })
          )
      )
    );
    rmSync(temp, { recursive: true, force: true });
  }
};
main().catch((error: Error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});

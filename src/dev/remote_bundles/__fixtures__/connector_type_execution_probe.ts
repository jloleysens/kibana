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
import { createPublicKey, createHash, createHmac, verify } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import { readFileSync, writeFileSync, appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Duplex } from 'node:stream';
import { execFileSync } from 'node:child_process';

import type { Metafile } from 'esbuild';
import type { SpecRuntimeApi } from '@kbn/connector-specs';
import type { NativeActionsApi } from '@kbn/actions-plugin/server';
import type { RemoteWorkerSpec } from '@kbn/core-remote-common';
import type { Client } from '@elastic/elasticsearch';
import { createLegacySmtpFake } from './legacy_smtp_fake';
import {
  mcpConnectorCase,
  classicConnectorCases,
  classicConnectorResponse,
  legacyConnectorCases,
  legacyConnectorResponse,
} from './legacy_connector_cases';

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
  config: Record<string, unknown>;
  secrets: Record<string, unknown>;
  params?: Record<string, unknown>;
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
    'slack.com',
    'hooks.torq.io',
    'gmail.googleapis.com',
    'www.googleapis.com',
    'oauth2.googleapis.com',
    'iam.googleapis.com',
    'secretmanager.googleapis.com',
    'bigquery.googleapis.com',
    'run.googleapis.com',
    'login.microsoftonline.com',
    'api.1password.com',
    'api.atlassian.com',
    'api.zoom.us',
    'graph.microsoft.com',
    'api.hubapi.com',
    'api.figma.com',
    'cloudresourcemanager.googleapis.com',
    'api.notion.com',
    'api.rootly.com',
    'api.datadoghq.com',
    'api.newrelic.com',
    'api.platform.censys.io',
    'lambda.us-east-1.amazonaws.com',
    's3.us-east-1.amazonaws.com',
    'api.greynoise.io',
    'api.shodan.io',
    'api.urlvoid.com',
    'api.search.brave.com',
    'urlscan.io',
    'api.firecrawl.dev',
    'api.abuseipdb.com',
    'www.virustotal.com',
    'fake.zendesk.com',
    'otx.alienvault.com',
    'fake.atlassian.net',
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
      'subjectAltName=' + domains.map((d) => 'DNS:' + d).join(',') + ',IP:127.0.0.1',
    ],
    { stdio: 'ignore' }
  );
  let requests = 0;
  const seen: Array<{ host?: string; path?: string }> = [];
  const serve = async (req: IncomingMessage, res: ServerResponse) => {
    let text = '';
    for await (const c of req) text += c;
    requests++;
    if (req.url?.startsWith('/authorize')) {
      const authorization = new URL(req.url, 'https://local-fake');
      const callback = new URL(authorization.searchParams.get('redirect_uri') ?? '');
      callback.searchParams.set('code', 'fake-code');
      callback.searchParams.set('state', authorization.searchParams.get('state') ?? '');
      res.writeHead(302, { location: callback.href });
      res.end();
      return;
    }
    if (req.url?.includes('/token')) {
      const fields = req.headers['content-type']?.includes('application/json')
        ? JSON.parse(text)
        : Object.fromEntries(new URLSearchParams(text));
      if (fields.client_assertion || fields.assertion) {
        const parts = (fields.client_assertion ?? fields.assertion).split('.');
        if (fields.client_assertion)
          assert.equal(JSON.parse(Buffer.from(parts[0], 'base64url').toString()).kid, 'fake-key');
        assert(
          verify(
            'RSA-SHA256',
            Buffer.from(parts.slice(0, 2).join('.')),
            createPublicKey(readFileSync(join(temp, 'key.pem'))),
            Buffer.from(parts[2], 'base64url')
          )
        );
      } else if (fields.grant_type === 'password') {
        assert.equal(fields.email, 'fake@example.com');
        assert.equal(fields.password, 'fake-password');
      } else if (fields.client_secret) {
        assert.equal(fields.client_id, 'fake-client');
        assert.equal(fields.client_secret, 'fake-secret');
      } else {
        assert.equal(
          req.headers.authorization,
          'Basic ' + Buffer.from('fake-client:fake-secret').toString('base64')
        );
      }
      if (process.argv[3] === '--serve' && fields.assertion)
        appendFileSync(
          process.argv[4] + '.requests.jsonl',
          JSON.stringify({
            at: new Date().toISOString(),
            pid: process.pid,
            operation: 'gcp-jwt',
            signatureVerified: true,
            idToken: Boolean(
              JSON.parse(Buffer.from(fields.assertion.split('.')[1], 'base64url').toString())
                .target_audience
            ),
          }) + '\n'
        );
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          access_token: 'fake-oauth-token',
          refresh_token: 'fake-refresh-token',
          id_token: 'fake-id-token',
          token_type: 'Bearer',
          expires_in: 3600,
        })
      );
      return;
    }
    if (req.headers.authorization?.startsWith('Bearer k8s-aws-v1.')) {
      const signed = new URL(
        Buffer.from(
          req.headers.authorization.slice('Bearer k8s-aws-v1.'.length),
          'base64url'
        ).toString()
      );
      const query = Object.fromEntries(signed.searchParams);
      const signature = query['X-Amz-Signature'];
      delete query['X-Amz-Signature'];
      const canonicalQuery = Object.keys(query)
        .sort()
        .map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(query[key]))
        .join('&');
      const canonical = [
        'GET',
        '/',
        canonicalQuery,
        `host:${signed.host}\nx-k8s-aws-id:fake-cluster\n`,
        'host;x-k8s-aws-id',
        createHash('sha256').update('').digest('hex'),
      ].join('\n');
      const scope = query['X-Amz-Credential'].split('/').slice(1);
      let key = Buffer.from('AWS4fake-secret');
      for (const part of scope) key = createHmac('sha256', key).update(part).digest();
      const expected = createHmac('sha256', key)
        .update(
          [
            'AWS4-HMAC-SHA256',
            query['X-Amz-Date'],
            scope.join('/'),
            createHash('sha256').update(canonical).digest('hex'),
          ].join('\n')
        )
        .digest('hex');
      assert.equal(signature, expected, 'EKS token signature and cluster binding must match');
    }
    seen.push({ host: req.headers.host, path: req.url });
    if (process.argv[3] === '--serve')
      appendFileSync(
        process.argv[4] + '.requests.jsonl',
        JSON.stringify({
          at: new Date().toISOString(),
          pid: process.pid,
          host: req.headers.host,
          path: req.url,
          mcpMethod: req.url?.startsWith('/mcp') && text ? JSON.parse(text).method : undefined,
          earsToken: req.headers.authorization?.startsWith('Bearer ears-') ?? false,
          staleEars: req.headers.authorization?.endsWith('-r1') ?? false,
        }) + '\n'
      );
    if (
      req.headers.host === 'slack.com' &&
      req.headers.authorization?.startsWith('Bearer ears-') &&
      req.headers.authorization.endsWith('-r1')
    ) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'token_expired' }));
      return;
    }

    if (req.headers.host === 's3.us-east-1.amazonaws.com' || req.url?.startsWith('/azure')) {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(
        req.url?.startsWith('/azure')
          ? '<EnumerationResults><Containers><Container><Name>local-business</Name></Container></Containers></EnumerationResults>'
          : '<ListAllMyBucketsResult><Buckets><Bucket><Name>local-business</Name></Bucket></Buckets></ListAllMyBucketsResult>'
      );
      return;
    }
    const legacyBody = legacyConnectorResponse(req, text) ?? classicConnectorResponse(req, text);
    if (legacyBody) {
      res.writeHead(req.url === '/legacy/pagerduty' ? 202 : 200, {
        'content-type': req.url === '/legacy/slack' ? 'text/plain' : 'application/json',
      });
      res.end(req.url === '/legacy/slack' ? 'ok' : JSON.stringify(legacyBody));
      return;
    }
    let body: object = {
      ok: true,
      id: 'local-business',
      user: 'local-business',
      user_id: 'local-business',
      team_id: 'fake',
      labels: [{ id: 'local-business', name: 'local-business' }],
      files: [{ id: 'local-business', name: 'local-business' }],
      items: [{ id: 'local-business', summary: 'local-business' }],
      value: [{ id: 'local-business', displayName: 'local-business' }],
      marker: 'local-business',
      data: [],
      results: [],
      total: 'local-business',
    };
    if (req.headers.host === 'www.virustotal.com')
      body = { data: { id: 'local-business', attributes: { country: 'GB' } } };
    if (req.url?.includes('/organizations/fake/issues/'))
      body = [{ id: 'fake', marker: 'local-business' }];
    if (req.headers.host === 'lambda.us-east-1.amazonaws.com')
      body = { Functions: [{ FunctionName: 'local-business' }] };
    if (req.headers.host === 'api.rootly.com')
      body = { data: [{ id: 'local-business', attributes: { marker: 'local-business' } }] };
    if (req.headers.host === 'api.newrelic.com')
      body = {
        data: { actor: { account: { alerts: { mutingRules: [{ marker: 'local-business' }] } } } },
      };
    if (req.url === '/function-business')
      assert.equal(req.headers.authorization, 'Bearer fake-id-token');
    if (req.headers.host === 'run.googleapis.com' && req.url?.includes('/services/'))
      body = {
        name: 'projects/fake/locations/us-east1/services/fake',
        uri: tlsUrl + '/function-business',
      };
    if (req.headers.host === 'run.googleapis.com' && !req.url?.includes('/services/'))
      body = { services: [{ name: 'local-business' }] };
    if (req.headers.host === 'iam.googleapis.com')
      body = { accounts: [{ name: 'local-business', email: 'fake@runner.invalid' }] };
    if (req.headers.host === 'secretmanager.googleapis.com')
      body = { secrets: [{ name: 'projects/fake/secrets/local-business' }] };
    if (req.headers.host === 'bigquery.googleapis.com')
      body = { datasets: [{ datasetReference: { datasetId: 'local-business' } }] };
    if (req.url?.startsWith('/api/v1/namespaces'))
      body = { kind: 'NamespaceList', items: [{ metadata: { name: 'local-business' } }] };
    if (req.url?.startsWith('/llm/')) {
      body = req.url.includes('/bedrock/')
        ? {
            completion: 'local-business',
            usage: { input_tokens: 1, output_tokens: 1 },
            stop_reason: 'end_turn',
          }
        : req.url.includes('/gemini/')
        ? {
            candidates: [{ content: { parts: [{ text: 'local-business' }] } }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
          }
        : {
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'local-business' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
    }
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
          ? { tools: [{ name: 'local-business', inputSchema: { type: 'object' } }] }
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
  const smtp = await createLegacySmtpFake((text) => {
    requests++;
    if (process.argv[3] === '--serve')
      appendFileSync(
        process.argv[4] + '.smtp.jsonl',
        JSON.stringify({ at: new Date().toISOString(), pid: process.pid, text }) + '\n'
      );
  });
  const url = `http://127.0.0.1:${port(fake)}`;
  const tlsUrl = `https://127.0.0.1:${port(tlsFake)}`;
  const tlsSecrets = {
    caCert: readFileSync(join(temp, 'cert.pem'), 'utf8'),
    verificationMode: 'full',
  };
  const bearer = { authType: 'bearer', token: 'fake-token' };
  const basic = { authType: 'basic', username: 'fake', password: 'fake' };
  const authorizationCode = {
    authType: 'oauth_authorization_code',
    authorizationUrl: tlsUrl + '/authorize',
    tokenUrl: tlsUrl + '/token',
    clientId: 'fake-client',
    clientSecret: 'fake-secret',
  };
  const cases: Case[] = [
    {
      type: 'google_threat_intelligence',
      op: 'getIpReport',
      config: {
        baseUrl: url,
      },
      secrets: {
        authType: 'api_key_header',
        'x-apikey': 'fake-key',
      },
      params: {
        ipAddress: '1.1.1.1',
      },
    },
    {
      type: 'ansible_controller',
      op: 'request',
      config: {
        apiUrl: tlsUrl,
      },
      secrets: {
        authType: 'bearer_with_tls',
        token: 'fake-token',
        ...tlsSecrets,
      },
      params: {
        method: 'GET',
        path: '/business',
      },
    },
    {
      type: 'misp',
      op: 'getEvent',
      config: {
        url: tlsUrl,
      },
      secrets: {
        authType: 'api_key_header_with_tls',
        apiKey: 'fake-key',
        ...tlsSecrets,
      },
      params: {
        eventId: '1',
      },
    },
    {
      type: 'sublime_security',
      op: 'listMailboxes',
      config: {
        baseUrl: url,
      },
      secrets: {
        authType: 'bearer',
        token: 'fake-token',
      },
    },
    {
      type: 'urlscan_io',
      op: 'searchScans',
      config: {},
      secrets: {
        authType: 'none',
      },
      params: {
        q: 'domain:fake.example',
      },
    },
    {
      type: 'firecrawl',
      op: 'getCrawlStatus',
      config: {},
      secrets: {
        authType: 'bearer',
        token: 'fake-token',
      },
      params: {
        id: '00000000-0000-4000-a000-000000000001',
      },
    },
    {
      type: 'solarwinds_platform',
      op: 'query',
      config: {
        url: tlsUrl,
      },
      secrets: {
        authType: 'basic_with_tls',
        username: 'fake',
        password: 'fake',
        ...tlsSecrets,
      },
      params: {
        query: 'SELECT Caption FROM Orion.Nodes',
      },
    },
    {
      type: 'abuseipdb',
      op: 'checkIp',
      config: {},
      secrets: {
        authType: 'api_key_header',
        Key: 'fake-key',
      },
      params: {
        ipAddress: '1.1.1.1',
      },
    },
    {
      type: 'virustotal',
      op: 'getIpReport',
      config: {},
      secrets: {
        authType: 'api_key_header',
        'x-apikey': 'fake-key',
      },
      params: {
        ip: '1.1.1.1',
      },
    },
    {
      type: 'zendesk',
      op: 'whoAmI',
      config: {
        subdomain: 'fake',
      },
      secrets: {
        authType: 'basic',
        username: 'fake',
        password: 'fake',
      },
    },
    {
      type: 'alienvault-otx',
      op: 'getPulse',
      config: {},
      secrets: {
        authType: 'api_key_header',
        'X-OTX-API-KEY': 'fake-key',
      },
      params: {
        pulseId: 'fake',
      },
    },
    {
      type: 'confluence-cloud',
      op: 'listSpaces',
      config: {
        subdomain: 'fake',
      },
      secrets: {
        authType: 'basic',
        username: 'fake',
        password: 'fake',
      },
    },
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

    {
      type: 'tavily_mcp',
      op: 'listTools',
      config: {
        serverUrl: url + '/mcp',
      },
      secrets: {
        authType: 'bearer',
        token: 'fake-token',
      },
    },
    {
      type: 'sharepoint-server',
      op: 'getWeb',
      config: {
        siteUrl: url,
      },
      secrets: {
        authType: 'basic',
        username: 'fake',
        password: 'fake',
      },
    },
    {
      type: 'greynoise',
      op: 'quickLookup',
      config: {},
      secrets: {
        authType: 'api_key_header',
        key: 'fake-key',
      },
      params: {
        ip: '1.1.1.1',
      },
    },
    {
      type: 'jina',
      op: 'browse',
      config: {
        overrideBrowseUrl: url,
      },
      secrets: {
        authType: 'bearer',
        token: 'fake-token',
      },
      params: {
        url: 'https://fake.example',
      },
    },
    {
      type: 'shodan',
      op: 'getServices',
      config: {},
      secrets: {
        authType: 'api_key_header',
        'X-Api-Key': 'fake-key',
      },
    },
    {
      type: 'urlvoid',
      op: 'scanDomainStats',
      config: {},
      secrets: {
        authType: 'api_key_header',
        'X-Api-Key': 'fake-key',
      },
    },
    {
      type: 'brave-search',
      op: 'webSearch',
      config: {},
      secrets: {
        authType: 'api_key_header',
        'X-Subscription-Token': 'fake-key',
      },
      params: {
        q: 'local-business',
      },
    },
    {
      type: 'aws_lambda',
      op: 'listFunctions',
      config: {
        region: 'us-east-1',
      },
      secrets: {
        authType: 'aws_credentials',
        accessKeyId: 'fake-access',
        secretAccessKey: 'fake-secret',
      },
    },
    {
      type: 'amazon_s3',
      op: 'listBuckets',
      config: {
        region: 'us-east-1',
      },
      secrets: {
        authType: 'aws_credentials',
        accessKeyId: 'fake-access',
        secretAccessKey: 'fake-secret',
      },
    },
    {
      type: 'azure-blob',
      op: 'listContainers',
      config: {
        accountUrl: url + '/azure',
      },
      secrets: {
        authType: 'azure_shared_key',
        accountName: 'fake',
        accountKey: 'ZmFrZS1rZXk=',
      },
    },
    {
      type: '1password',
      op: 'listUsers',
      config: { accountUuid: 'fake' },
      secrets: {
        authType: 'oauth_client_credentials',
        tokenUrl: 'https://api.1password.com/v1beta1/users/oauth2/token',
        clientId: 'fake-client',
        clientSecret: 'fake-secret',
        tokenEndpointAuthMethod: 'client_secret_basic',
      },
    },
    {
      type: 'threatq',
      op: 'listIndicatorTypes',
      config: { url: tlsUrl },
      secrets: {
        authType: 'oauth_password',
        tokenUrl: tlsUrl + '/api/token',
        username: 'fake@example.com',
        password: 'fake-password',
        clientId: 'fake-client',
        usernameField: 'email',
        requestBodyFormat: 'json',
        tokenType: 'Bearer',
      },
    },
    {
      type: 'okta',
      op: 'listUsers',
      config: { orgUrl: tlsUrl },
      secrets: {
        authType: 'oauth_client_credentials_private_key_jwt',
        tokenUrl: tlsUrl + '/oauth2/v1/token',
        clientId: 'fake-client',
        algorithm: 'RS256',
        certificateBinding: 'kid',
        keyId: 'fake-key',
        privateKey: readFileSync(join(temp, 'key.pem'), 'utf8'),
      },
    },
    {
      type: 'github',
      op: 'listTools',
      config: { serverUrl: url + '/mcp' },
      secrets: { ...authorizationCode },
    },
    {
      type: 'servicenow_search',
      op: 'whoAmI',
      config: { instanceUrl: tlsUrl },
      secrets: { ...authorizationCode },
    },
    {
      type: 'box',
      op: 'listTools',
      config: { serverUrl: url + '/mcp' },
      secrets: { ...authorizationCode },
    },
    {
      type: 'jira-cloud',
      op: 'getProjects',
      config: { subdomain: 'fake', cloudId: 'fake' },
      secrets: { ...authorizationCode },
    },
    {
      type: 'monday_com',
      op: 'listTools',
      config: { serverUrl: url + '/mcp' },
      secrets: { ...authorizationCode },
    },
    {
      type: 'snowflake',
      op: 'listDatabases',
      config: { accountUrl: tlsUrl },
      secrets: { ...authorizationCode },
    },
    {
      type: 'dropbox',
      op: 'listTools',
      config: { serverUrl: url + '/mcp' },
      secrets: { ...authorizationCode },
    },
    { type: 'zoom', op: 'whoAmI', config: {}, secrets: { ...authorizationCode } },
    { type: 'one_drive', op: 'getMe', config: {}, secrets: { ...authorizationCode } },
    { type: 'hubspot', op: 'listOwners', config: {}, secrets: { ...authorizationCode } },
    { type: 'outlook', op: 'listFolders', config: {}, secrets: { ...authorizationCode } },
    {
      type: 'salesforce',
      op: 'query',
      config: {},
      secrets: { ...authorizationCode, tokenUrl: tlsUrl + '/services/oauth2/token' },
      params: { soql: 'SELECT Id FROM Account LIMIT 1' },
    },
    { type: 'figma', op: 'whoAmI', config: {}, secrets: { ...authorizationCode } },
    {
      type: 'google_cloud_storage',
      op: 'listProjects',
      config: {},
      secrets: { ...authorizationCode },
    },
    {
      type: 'notion',
      op: 'getPage',
      config: {},
      secrets: { ...authorizationCode },
      params: { pageId: '00000000-0000-4000-a000-000000000001' },
    },
  ];
  const serviceAccountJson = JSON.stringify({
    type: 'service_account',
    client_email: 'fake@runner.invalid',
    project_id: 'fake',
    private_key: readFileSync(join(temp, 'key.pem'), 'utf8'),
  });
  cases.push(
    {
      type: 'gcp_iam',
      op: 'listServiceAccounts',
      config: {},
      secrets: { authType: 'gcp_service_account', serviceAccountJson },
      params: { projectId: 'fake-project' },
    },
    {
      type: 'gcp_secret_manager',
      op: 'listSecrets',
      config: {},
      secrets: { authType: 'gcp_service_account', serviceAccountJson },
      params: { projectId: 'fake-project' },
    },
    {
      type: 'bigquery',
      op: 'listDatasets',
      config: { projectId: 'fake-project' },
      secrets: { authType: 'gcp_service_account', serviceAccountJson },
      params: {},
    },
    {
      type: 'gcp_cloud_functions',
      op: 'invoke',
      config: { projectId: 'fake-project', region: 'us-east1' },
      secrets: { authType: 'gcp_service_account', serviceAccountJson },
      params: { projectId: 'fake-project', region: 'us-east1', functionName: 'fake' },
    },
    {
      type: 'kubernetes',
      op: 'listNamespaces',
      config: { apiUrl: tlsUrl },
      secrets: { authType: 'bearer_with_tls', token: 'fake-token', ...tlsSecrets },
      params: {},
    }
  );
  cases.push(
    {
      type: 'slack2',
      op: 'whoAmI',
      config: {},
      secrets: { authType: 'ears', provider: 'slack' },
      params: {},
    },
    {
      type: 'gmail',
      op: 'listLabels',
      config: {},
      secrets: { authType: 'ears', provider: 'google' },
      params: {},
    },
    {
      type: 'sharepoint-online',
      op: 'getAllSites',
      config: {},
      secrets: { authType: 'ears', provider: 'microsoft' },
      params: {},
    },
    {
      type: 'microsoft-teams',
      op: 'getUser',
      config: {},
      secrets: { authType: 'ears', provider: 'microsoft' },
      params: { userId: 'fake' },
    },
    {
      type: 'google_calendar',
      op: 'listCalendars',
      config: {},
      secrets: { authType: 'ears', provider: 'google' },
      params: {},
    },
    {
      type: 'google_drive',
      op: 'listFiles',
      config: {},
      secrets: { authType: 'ears', provider: 'google' },
      params: {},
    }
  );
  let current = cases[0];
  let prepares = 0;
  const finalizes: number[] = [];
  const actions: NativeActionsApi = {
    dashboard: async () => {
      throw new Error('No dashboard invocation in spec fixture');
    },
    relay: async () => ({ error: {} }),
    token: async (_scope, _invocation, request) => ({
      hasErrors: false,
      connectorToken:
        request.operation === 'get' &&
        ['oauth_authorization_code', 'ears'].includes(String(current.secrets.authType))
          ? {
              id: 'per-user:fake',
              profileUid: 'fake-profile',
              connectorId: current.type,
              credentialType: 'oauth',
              credentials: { accessToken: 'Bearer fake-oauth-token', refreshToken: 'fake-refresh' },
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : null,
    }),
    prepare: async (_s, invocationId, request) => {
      prepares++;
      return {
        prepared: {
          connectorVersion: 'fake-version',
          kibanaVersion: '9.7.0',
          authMode: ['oauth_authorization_code', 'ears'].includes(String(current.secrets.authType))
            ? 'per-user'
            : 'shared',
          profileUid: ['oauth_authorization_code', 'ears'].includes(
            String(current.secrets.authType)
          )
            ? 'fake-profile'
            : undefined,
          actionId: current.type,
          actionTypeId: '.' + current.type,
          name: current.type,
          config:
            'legacy' in current
              ? current.config
              : { ...current.config, selectedActions: [current.op] },
          secrets: current.secrets,
          params: request.input,
          runtimeConfig: {
            allowedHosts: ['127.0.0.1', ...domains],
            enabledActionTypes: ['*'],
            ssl: { verificationMode: 'full', proxyVerificationMode: 'full' },
            proxyUrl: `http://127.0.0.1:${port(proxy)}`,
            proxyBypassHosts: ['127.0.0.1'],
            customHostSettings: [
              {
                url: tlsUrl,
                ssl: {
                  verificationMode: 'full' as const,
                  certificateAuthoritiesData: readFileSync(join(temp, 'cert.pem'), 'utf8'),
                },
              },
              ...domains.map((d) => ({
                url: 'https://' + d + ':443',
                ssl: {
                  verificationMode: 'full' as const,
                  certificateAuthoritiesData: readFileSync(join(temp, 'cert.pem'), 'utf8'),
                },
              })),
            ],
            webhook: { ssl: { pfx: { enabled: true } } },
            auth: {
              oauth_authorization_code: {
                rate_limits: {
                  authorize: { limit: 100, lookbackWindow: '1h' },
                  callback: { limit: 100, lookbackWindow: '1h' },
                },
              },
              ears: { enabled: true, enableExperimental: true, url: tlsUrl },
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
  let esClient: Client | undefined;
  const events: Array<{
    type: string;
    operation: string;
    ms: number;
    heapIncrement: number;
    requests: number;
  }> = [];
  try {
    await sample('fake_setup');
    if (['--legacy', '--serve'].includes(process.argv[3])) {
      const { Client: ElasticsearchClient } = await import('@elastic/elasticsearch');
      esClient = new ElasticsearchClient({ node: url });
    }
    if (process.argv[3] === '--serve') {
      const result = await actions.prepare('fixture', 'fixture', {
        connectorType: current.type,
        connectorNameOrId: current.type,
        input: {},
      });
      assert('prepared' in result);
      const measurementCases = [
        ...legacyConnectorCases(url),
        ...classicConnectorCases(url, smtp.port),
        mcpConnectorCase(url),
        ...cases.map((entry) =>
          entry.secrets.authType === 'ears'
            ? {
                ...entry,
                secrets:
                  entry.type === 'sharepoint-online'
                    ? {
                        authType: 'oauth_client_credentials',
                        clientId: 'fake-client',
                        clientSecret: 'fake-secret',
                        tokenUrl: tlsUrl + '/token',
                      }
                    : { authType: 'bearer', token: 'fake-token' },
              }
            : entry
        ),
        {
          type: 'gen-ai',
          op: 'run',
          legacy: true,
          config: {
            apiUrl: url + '/llm/openai/v1/chat/completions',
            apiProvider: 'Other',
            defaultModel: 'fake',
          },
          secrets: { apiKey: 'fake-key' },
          params: {
            body: JSON.stringify({ messages: [{ role: 'user', content: 'local-business' }] }),
          },
        },
        {
          type: 'bedrock',
          op: 'run',
          legacy: true,
          config: { apiUrl: url + '/llm/bedrock', region: 'us-east-1', defaultModel: 'fake' },
          secrets: { accessKey: 'fake-access', secret: 'fake-secret' },
          params: { body: JSON.stringify({ prompt: 'local-business', max_tokens_to_sample: 20 }) },
        },
        {
          type: 'gemini',
          op: 'run',
          legacy: true,
          config: {
            apiUrl: url + '/llm/gemini',
            gcpProjectID: 'fake',
            gcpRegion: 'fake',
            defaultModel: 'fake',
          },
          secrets: {
            credentialsJson: JSON.stringify({
              type: 'service_account',
              client_email: 'fake@runner.invalid',
              project_id: 'fake',
              private_key: readFileSync(join(temp, 'key.pem'), 'utf8'),
            }),
          },
          params: { body: JSON.stringify({ contents: [] }) },
        },
        {
          type: 'inference',
          op: 'completion',
          legacy: true,
          config: {
            inferenceId: 'measure-inference-' + Date.now(),
            provider: 'openai',
            taskType: 'completion',
            providerConfig: { model_id: 'fake', url: url + '/llm/inference/v1/chat/completions' },
          },
          secrets: { providerSecrets: { api_key: 'fake-key' } },
          params: { input: 'local-business' },
        },
      ];
      writeFileSync(
        process.argv[4],
        JSON.stringify(
          {
            pid: process.pid,
            cases: measurementCases,
            runtimeConfig: result.prepared.runtimeConfig,
            certificateAuthority: readFileSync(join(temp, 'cert.pem'), 'utf8'),
          },
          null,
          2
        ),
        { mode: 0o600 }
      );
      await new Promise<void>((done) => process.once('SIGTERM', done));
      return;
    }
    const executionCases =
      process.argv[3] === '--legacy'
        ? [
            ...legacyConnectorCases(url),
            ...classicConnectorCases(url, smtp.port),
            mcpConnectorCase(url),
          ]
        : cases;
    if (process.argv[3] === '--legacy') {
      for (const suffix of ['/token_tracking/gen_ai_token_tracking.ts', '/email/send_email.ts']) {
        const capability = Object.entries(metadata.outputs).find(([, output]) =>
          output.entryPoint?.endsWith(suffix)
        );
        assert(capability);
        await import(pathToFileURL(resolve(capability[0])).href);
      }
      await sample('legacy_shared_capabilities');
    }
    for (const entry of executionCases) {
      current = entry;
      const contribution = graph.spec.contributions.find((c) => c.stepType === entry.type);
      assert(contribution);
      const before = samples[samples.length - 1];
      const started = performance.now();
      const mod = await graph.implementations[contribution.modulePath]();
      const klass = mod[contribution.exportName] as new (
        service: SpecRuntimeApi,
        data: { user(): Client }
      ) => Connector;
      assert(klass);
      const connector = new klass(runtime, {
        user: () => {
          assert(esClient);
          return esClient;
        },
      });
      const beforeRequests = requests;
      const result = await connector.run(
        'scope',
        {
          connectorType: entry.type,
          connectorNameOrId: entry.type,
          system: false,
          input: entry.op
            ? { subAction: entry.op, subActionParams: entry.params ?? {} }
            : entry.params ?? {},
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
    await esClient?.close();
    await smtp.close();
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

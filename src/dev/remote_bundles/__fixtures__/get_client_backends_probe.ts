/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type Socket } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createConnection, type ConnectionOptions } from 'mysql2';
import { createToken } from '@kbn/core-di';
import type { Logger } from '@kbn/core/server';
import { RemoteService } from '@kbn/core-remote-server-internal';
import { configSchema } from '@kbn/actions-plugin/server/config';
import { serializeActionsConfiguration } from '@kbn/actions-plugin/server/actions_config';
import { ClientActions } from './get_client_plugin/server/remote/coordinator_actions';
import { buildRemoteBundle } from '../build';

interface ClientApi {
  warm(): Promise<void>;
  run(
    scopeId: string,
    type: 'mcp' | 'mysql'
  ): Promise<{
    result: { status: string; data: object };
    pid: number;
    heapIncrement: number;
  }>;
}

const main = async (): Promise<void> => {
  const backend = process.argv[3];
  assert(backend === 'in_process' || backend === 'child_process');
  const previousExposeGc = process.env.KBN_REMOTE_EXPOSE_GC;
  process.env.KBN_REMOTE_EXPOSE_GC = 'true';
  const directory = mkdtempSync(join(tmpdir(), 'get-client-backends-'));
  const sockets = new Set<Socket>();
  const queries: string[] = [];
  const methods: string[] = [];
  const mysql = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const options: ConnectionOptions & { isServer: true } = { stream: socket, isServer: true };
    const connection = createConnection(options);
    connection.on('error', () => socket.destroy());
    connection.on('quit', () => connection.end());
    connection.serverHandshake({
      protocolVersion: 10,
      serverVersion: '8.0.fixture',
      connectionId: 1,
      statusFlags: 2,
      characterSet: 45,
      capabilityFlags: 0x88205,
      authCallback: (_auth: object, done: (error: null) => void) => {
        done(null);
        connection.sequenceId = 0;
      },
    });
    connection.on('query', (sql: string) => {
      queries.push(sql);
      // mysql2's server wire methods are public at runtime but absent from its typings.
      connection.sequenceId = 1;
      const wire = connection as typeof connection & {
        writeColumns(columns: object[]): void;
        writeTextRow(values: string[]): void;
      };
      wire.writeColumns([
        {
          catalog: 'def',
          schema: 'fixture',
          table: '',
          orgTable: '',
          orgName: '',
          name: 'marker',
          columnType: 253,
          characterSet: 45,
          columnLength: 255,
          flags: 0,
          decimals: 0,
        },
      ]);
      wire.writeTextRow(['local-business']);
      wire.writeEof();
      connection.sequenceId = 0;
    });
  });
  const http = createHttpServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405);
      response.end();
      return;
    }
    let text = '';
    for await (const chunk of request) text += chunk;
    const rpc: { method: string; id?: number } = JSON.parse(text);
    methods.push(rpc.method);
    if (rpc.id === undefined) {
      response.writeHead(202);
      response.end();
      return;
    }
    const result =
      rpc.method === 'initialize'
        ? {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'fixture', version: '1' },
          }
        : { tools: [{ name: 'local-business', inputSchema: { type: 'object' } }] };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  });
  const service = new RemoteService(createLogger(), {
    maxOldGenerationSizeMb: 256,
    bundleDirectory: directory,
  });
  try {
    await Promise.all([
      new Promise<void>((done) => mysql.listen(0, '127.0.0.1', done)),
      new Promise<void>((done) => http.listen(0, '127.0.0.1', done)),
    ]);
    const mysqlAddress = mysql.address();
    const httpAddress = http.address();
    assert(mysqlAddress && typeof mysqlAddress === 'object');
    assert(httpAddress && typeof httpAddress === 'object');
    const plugin = resolve(process.argv[2]);
    await buildRemoteBundle({
      manifests: [join(plugin, 'server/remote/index.ts')],
      graph: {
        id: 'client-proof',
        root: 'client-proof.root',
        dependencies: [],
        contributions: [],
      },
      outdir: join(directory, 'client-proof'),
    });
    service.discover([plugin]);
    service.register({
      id: 'client-proof',
      root: createToken('client-proof.root'),
      dependencies: [],
      contributions: [],
    });
    const prepared = Object.fromEntries(
      ['mysql', 'pagerduty_mcp'].map((type) => [
        type,
        {
          kibanaVersion: '9.7.0',
          actionId: type === 'mysql' ? 'mysql' : 'mcp',
          actionTypeId: '.' + type,
          name: 'Fixture',
          connectorVersion: '1',
          config:
            type === 'mysql'
              ? {
                  host: '127.0.0.1',
                  port: mysqlAddress.port,
                  database: 'fixture',
                  ssl: 'disabled',
                }
              : { serverUrl: `http://127.0.0.1:${httpAddress.port}/mcp` },
          secrets:
            type === 'mysql'
              ? { authType: 'basic', username: 'fake', password: 'fake' }
              : { authType: 'api_key_header', Authorization: 'Token token=fake' },
          params:
            type === 'mysql'
              ? { subAction: 'query', subActionParams: { sql: 'SELECT marker FROM fixture' } }
              : { subAction: 'listTools', subActionParams: {} },
          runtimeConfig: serializeActionsConfiguration(
            configSchema.validate({ allowedHosts: ['127.0.0.1'] })
          ),
        },
      ])
    );
    const actions = new ClientActions(prepared, join(directory, 'finalizations.json'));
    const { finalizations } = actions;
    service.bind(createToken('client-proof.actions'), () => actions);
    await service.start(backend);
    const session = await service.whenReady<ClientApi>('client-proof');
    await session.stub.warm();
    const outputs = [];
    for (const type of ['mcp', 'mysql'] as const) {
      const scope = session.openScope({});
      const result = await session.stub.run(scope, type);
      assert.equal(result.result.status, 'ok', JSON.stringify(result));
      assert(JSON.stringify(result.result.data).includes('local-business'));
      assert.equal(result.pid === process.pid, backend === 'in_process');
      if (type === 'mcp' && backend === 'child_process')
        assert(result.heapIncrement <= 4 * 1024 * 1024, JSON.stringify(result));
      outputs.push({ type, ...result });
      session.closeScope(scope);
    }
    assert.deepEqual(queries, ['SELECT marker FROM fixture']);
    assert(methods.includes('initialize'));
    assert(methods.includes('tools/list'));
    assert.equal(finalizations.length, 2);
    assert.equal(JSON.parse(readFileSync(join(directory, 'finalizations.json'), 'utf8')).length, 2);
    const evidence = {
      backend,
      coordinatorPid: process.pid,
      outputs,
      queries,
      methods,
      finalizations,
      qualification:
        'Isolated SpecRuntime fixture with fake coordinator storage; original MySQL is NOT workflow eligible. No durable Actions event claim.',
    };
    if (process.env.KBN_CONNECTOR_REVIEW_ARTIFACTS) {
      mkdirSync(process.env.KBN_CONNECTOR_REVIEW_ARTIFACTS, { recursive: true });
      writeFileSync(
        join(process.env.KBN_CONNECTOR_REVIEW_ARTIFACTS, backend + '.json'),
        JSON.stringify(evidence, null, 2)
      );
    }
    process.stdout.write(JSON.stringify(evidence) + '\n');
  } finally {
    await service.stop();
    for (const socket of sockets) socket.destroy();
    http.closeAllConnections();
    await Promise.all([
      new Promise<void>((done) => mysql.close(() => done())),
      new Promise<void>((done) => http.close(() => done())),
    ]);
    if (previousExposeGc === undefined) delete process.env.KBN_REMOTE_EXPOSE_GC;
    else process.env.KBN_REMOTE_EXPOSE_GC = previousExposeGc;
    rmSync(directory, { recursive: true });
  }
};

const createLogger = (): Logger => {
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error(error) {
      process.stderr.write(String(error) + '\n');
    },
    trace() {},
    fatal() {},
    log() {},
    isLevelEnabled: () => false,
    get: () => logger,
  };
  return logger;
};
main().catch((error: Error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});

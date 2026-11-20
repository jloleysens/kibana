/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';

/** Real Slack HTTPS transport through an ephemeral loopback proxy, retaining certificate verification. */
export const startLaneBNotificationsFixture = async (logPath: string) => {
  const directory = mkdtempSync(join(tmpdir(), 'lane-b-slack-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(directory, 'key.pem'),
      '-out',
      join(directory, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=lane-b-slack',
      '-addext',
      'subjectAltName=DNS:slack.com',
    ],
    { stdio: 'ignore' }
  );
  const certificate = readFileSync(join(directory, 'cert.pem'), 'utf8');
  let posts = 0;
  let confirmAttempts = 0;
  const tls = createTlsServer(
    { key: readFileSync(join(directory, 'key.pem')), cert: certificate },
    async (request, response) => {
      assert.equal(request.headers.host, 'slack.com');
      assert.equal(request.headers.authorization, 'Bearer xoxb-lane-b-fake');
      let text = '';
      for await (const chunk of request) text += chunk;
      const body = JSON.parse(text);
      // The kitchen-sink confirm step uses this marker so the first attempt fails and the retry succeeds.
      // Other Slack posts, including Nightshift, stay successful.
      const fail =
        typeof body.text === 'string' &&
        body.text.includes('confirm-delivery') &&
        confirmAttempts++ % 2 === 0;
      appendFileSync(logPath, JSON.stringify({ path: request.url, body, fail }) + '\n');
      assert(['/api/chat.postMessage', '/api/chat.update'].includes(request.url ?? ''));
      if (fail) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: 'once' }));
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          ok: true,
          channel: body.channel,
          ts: body.ts ?? `123.${++posts}`,
          message: { text: body.text },
        })
      );
    }
  );
  await new Promise<void>((done) => tls.listen(0, '127.0.0.1', done));
  const address = tls.address();
  assert(address && typeof address !== 'string');
  const sockets = new Set<Duplex>();
  const proxy = createServer();
  proxy.on('connect', (request, socket, head) => {
    assert.equal(request.url, 'slack.com:443');
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const upstream = connect(address.port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on('error', (error) => socket.destroy(error));
    socket.on('error', () => upstream.destroy());
  });
  await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
  const proxyAddress = proxy.address();
  assert(proxyAddress && typeof proxyAddress !== 'string');
  return {
    config: {
      'xpack.actions.allowedHosts': ['127.0.0.1', 'slack.com'],
      'xpack.actions.proxyUrl': `http://127.0.0.1:${proxyAddress.port}`,
      'xpack.actions.proxyBypassHosts': ['127.0.0.1'],
      'xpack.actions.customHostSettings': [
        {
          url: 'https://slack.com:443',
          ssl: { verificationMode: 'full', certificateAuthoritiesData: certificate },
        },
      ],
    },
    connector: {
      name: 'Lane B fake Slack delivery',
      actionTypeId: '.slack2',
      config: { selectedActions: ['sendMessage', 'updateMessage'] },
      secrets: { authType: 'bearer', token: 'xoxb-lane-b-fake' },
    },
    close: async (): Promise<void> => {
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        new Promise<void>((done) => proxy.close(() => done())),
        new Promise<void>((done) => tls.close(() => done())),
      ]);
      rmSync(directory, { recursive: true, force: true });
    },
  };
};

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
import { createServer, type Socket } from 'node:net';

export const createLegacySmtpFake = async (onMessage: (text: string) => void) => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    socket.write('220 runner.invalid SMTP fake\r\n');
    let pending = '';
    let data = false;
    let message = '';
    socket.on('data', (chunk) => {
      pending += chunk;
      while (pending.includes('\r\n')) {
        const end = pending.indexOf('\r\n');
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (data) {
          if (line === '.') {
            assert(message.includes('local-business'));
            onMessage(message);
            message = '';
            data = false;
            socket.write('250 local-business accepted\r\n');
          } else message += line + '\r\n';
        } else if (/^(EHLO|HELO) /.test(line)) socket.write('250 runner.invalid\r\n');
        else if (/^(MAIL FROM:|RCPT TO:|RSET|NOOP)/.test(line)) socket.write('250 OK\r\n');
        else if (line === 'DATA') {
          data = true;
          socket.write('354 End with dot\r\n');
        } else if (line === 'QUIT') socket.end('221 Bye\r\n');
        else assert.fail('Unexpected SMTP command ' + line);
      }
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    port: address.port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
};

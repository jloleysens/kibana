/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import assert from 'node:assert/strict';
import { CA_CERT_PATH, KBN_CERT_PATH, KBN_KEY_PATH } from '@kbn/dev-utils';
import { appendFileSync, readFileSync } from 'node:fs';
import { Server, ServerCredentials, type ServerUnaryCall, type sendUnaryData } from '@grpc/grpc-js';

const encodeVarint = (value: number): Buffer => {
  const bytes: number[] = [];
  let remaining = value;
  do {
    const next = remaining % 128;
    remaining = Math.floor(remaining / 128);
    bytes.push(next + (remaining ? 128 : 0));
  } while (remaining);
  return Buffer.from(bytes);
};
const nested = (field: number, content: Buffer): Buffer =>
  Buffer.concat([encodeVarint(field * 8 + 2), encodeVarint(content.length), content]);
const fields = (buffer: Buffer): Array<{ field: number; content: Buffer }> => {
  let offset = 0;
  const readVarint = (): number => {
    let value = 0;
    let scale = 1;
    let byte: number;
    do {
      assert(offset < buffer.length, 'Truncated sandbox fixture request');
      byte = buffer[offset++];
      value += (byte % 128) * scale;
      scale *= 128;
    } while (byte >= 128);
    return value;
  };
  const result: Array<{ field: number; content: Buffer }> = [];
  while (offset < buffer.length) {
    const tag = readVarint();
    assert.equal(tag % 8, 2, 'Fixture expects length-delimited request fields only');
    const length = readVarint();
    assert(offset + length <= buffer.length);
    result.push({ field: Math.floor(tag / 8), content: buffer.subarray(offset, offset + length) });
    offset += length;
  }
  return result;
};

/** Filesystem-only TLS wire fixture: exercises original sandbox RPCs, never executes code. */
export const startLaneBSandboxFixture = async (logFile: string) => {
  const server = new Server();
  const definition = (method: string) => ({
    path: '/sandbox.SandboxService/' + method,
    requestStream: false,
    responseStream: false,
    requestSerialize: (value: Buffer) => value,
    requestDeserialize: (value: Buffer) => value,
    responseSerialize: (value: Buffer) => value,
    responseDeserialize: (value: Buffer) => value,
  });
  const handle =
    (operation: string, run: (request: Buffer) => { response: Buffer; record: object }) =>
    (call: ServerUnaryCall<Buffer, Buffer>, callback: sendUnaryData<Buffer>) => {
      try {
        const conversationId = call.metadata.get('x-conversation-id')[0];
        assert.equal(call.metadata.get('authorization')[0], 'ApiKey lane-b-stat-only-fixture');
        assert.equal(typeof conversationId, 'string');
        const { response, record } = run(call.request);
        appendFileSync(logFile, JSON.stringify({ operation, conversationId, ...record }) + '\n');
        callback(null, response);
      } catch (error) {
        callback(error);
      }
    };
  server.addService(
    {
      statFiles: definition('StatFiles'),
      mkdirs: definition('Mkdirs'),
      writeFiles: definition('WriteFiles'),
    },
    {
      statFiles: handle('stat', (request) => {
        assert.deepEqual(
          request,
          Buffer.concat([Buffer.from([10, 10]), Buffer.from('/workspace')])
        );
        const metadata = Buffer.concat([request, Buffer.from([24, 1, 32, 1])]);
        return { record: { path: '/workspace' }, response: nested(1, metadata) };
      }),
      mkdirs: handle('mkdirs', (request) => {
        const paths = fields(request).map(({ content }) => content.toString('utf8'));
        assert.deepEqual(paths, ['/workspace/decision-trees']);
        return { record: { paths }, response: Buffer.from([8, 1]) };
      }),
      writeFiles: handle('write', (request) => {
        const files = fields(request).map(({ content }) => {
          const entries = fields(content);
          const path = entries.find(({ field }) => field === 1)?.content.toString('utf8');
          const text = entries.find(({ field }) => field === 2)?.content.toString('utf8');
          assert(path?.startsWith('/workspace/decision-trees/'));
          assert.equal(typeof text, 'string');
          return { path, content: text };
        });
        return {
          record: { files },
          response: Buffer.concat(
            files.map(({ content }) =>
              nested(
                1,
                Buffer.concat([
                  Buffer.from([8]),
                  encodeVarint(Buffer.byteLength(content ?? '')),
                  Buffer.from([16, 1]),
                ])
              )
            )
          ),
        };
      }),
    }
  );
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync(
      '127.0.0.1:0',
      ServerCredentials.createSsl(null, [
        { private_key: readFileSync(KBN_KEY_PATH), cert_chain: readFileSync(KBN_CERT_PATH) },
      ]),
      (error, boundPort) => {
        if (error) reject(error);
        else resolve(boundPort);
      }
    );
  });
  return {
    port,
    caPath: CA_CERT_PATH,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.tryShutdown((error) => (error ? reject(error) : resolve()));
      }),
  };
};

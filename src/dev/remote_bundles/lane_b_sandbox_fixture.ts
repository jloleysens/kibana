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
const fields = (buffer: Buffer): Array<{ field: number; content: Buffer; integer?: number }> => {
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
  const result: Array<{ field: number; content: Buffer; integer?: number }> = [];
  while (offset < buffer.length) {
    const tag = readVarint();
    if (tag % 8 === 0) {
      result.push({ field: Math.floor(tag / 8), content: Buffer.alloc(0), integer: readVarint() });
      continue;
    }
    assert.equal(tag % 8, 2, 'Unexpected sandbox fixture request encoding');
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
  const filesystems = new Map<string, Map<string, Buffer>>();
  const filesystem = (conversationId: string): Map<string, Buffer> => {
    let files = filesystems.get(conversationId);
    if (!files) {
      files = new Map();
      filesystems.set(conversationId, files);
    }
    return files;
  };
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
    (
      operation: string,
      run: (request: Buffer, conversationId: string) => { response: Buffer; record: object }
    ) =>
    (call: ServerUnaryCall<Buffer, Buffer>, callback: sendUnaryData<Buffer>) => {
      try {
        const conversationId = call.metadata.get('x-conversation-id')[0];
        assert.equal(call.metadata.get('authorization')[0], 'ApiKey lane-b-stat-only-fixture');
        assert(typeof conversationId === 'string');
        const { response, record } = run(call.request, conversationId);
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
      readFiles: definition('ReadFiles'),
    },
    {
      statFiles: handle('stat', (request, conversationId) => {
        const paths = fields(request).map(({ content }) => content.toString('utf8'));
        const stats = paths.map((path) => {
          assert(path === '/workspace' || path.startsWith('/workspace/memories/'));
          const file = filesystem(conversationId).get(path);
          const directory = path === '/workspace';
          return {
            path,
            exists: directory || file !== undefined,
            isDir: directory,
            size: file?.length ?? 0,
          };
        });
        return {
          record: { paths },
          response: Buffer.concat(
            stats.map(({ path, exists, isDir, size }) =>
              nested(
                1,
                Buffer.concat([
                  nested(1, Buffer.from(path)),
                  Buffer.from([16]),
                  encodeVarint(size),
                  Buffer.from([24, Number(isDir), 32, Number(exists)]),
                ])
              )
            )
          ),
        };
      }),
      readFiles: handle('read', (request, conversationId) => {
        const files = fields(request).map(({ content }) => {
          const entries = fields(content);
          const path = entries.find(({ field }) => field === 1)?.content.toString('utf8');
          assert(typeof path === 'string' && path.startsWith('/workspace/memories/'));
          const maxBytes = entries.find(({ field }) => field === 2)?.integer;
          const contentBytes = filesystem(conversationId).get(path);
          const bytes = contentBytes?.subarray(0, maxBytes);
          return { path, content: bytes ?? Buffer.alloc(0), success: contentBytes !== undefined };
        });
        return {
          record: {
            files: files.map(({ path, content, success }) => ({
              path,
              contentBase64: content.toString('base64'),
              success,
            })),
          },
          response: Buffer.concat(
            files.map(({ path, content, success }) =>
              nested(
                1,
                Buffer.concat([
                  nested(1, Buffer.from(path)),
                  nested(2, content),
                  Buffer.from([24, Number(success)]),
                ])
              )
            )
          ),
        };
      }),
      mkdirs: handle('mkdirs', (request) => {
        const paths = fields(request).map(({ content }) => content.toString('utf8'));
        assert(
          paths.every(
            (path) =>
              path === '/workspace/memories' ||
              path === '/workspace/decision-trees' ||
              path === '/workspace/cortex' ||
              path.startsWith('/workspace/cortex/')
          )
        );
        return { record: { paths }, response: Buffer.concat(paths.map(() => Buffer.from([8, 1]))) };
      }),
      writeFiles: handle('write', (request, conversationId) => {
        const files = fields(request).map(({ content }) => {
          const entries = fields(content);
          const path = entries.find(({ field }) => field === 1)?.content.toString('utf8');
          const text = entries.find(({ field }) => field === 2)?.content.toString('utf8');
          assert(
            path?.startsWith('/workspace/memories/') ||
              path?.startsWith('/workspace/decision-trees/') ||
              path?.startsWith('/workspace/cortex/')
          );
          assert(typeof text === 'string');
          assert(path);
          filesystem(conversationId).set(path, Buffer.from(text));
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

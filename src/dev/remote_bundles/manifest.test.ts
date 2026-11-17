/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readRemoteManifest } from './manifest';

const fixture = resolve(
  __dirname,
  '../../core/packages/remote/server-internal/src/__fixtures__/demo_plugin/server/remote/index.ts'
);

it('interprets existing remotable manifests and token ids without executing implementations', () => {
  const manifest = readRemoteManifest(fixture);
  expect(manifest.providers.map(({ token, placement }) => ({ token, placement }))).toEqual([
    { token: 'demo.value', placement: 'executor' },
    { token: 'demo.echo', placement: 'coordinator' },
    { token: 'demo.catalog', placement: 'executor' },
    { token: 'demo.root', placement: 'executor' },
  ]);
  expect(manifest.contributions[0]).toMatchObject({
    kind: 'demo.step',
    stepType: 'demo.echoStep',
    exportName: 'EchoStep',
  });
});

it('never evaluates manifest top-level code or require.resolve targets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-manifest-'));
  try {
    const file = join(directory, 'index.ts');
    writeFileSync(join(directory, 'implementation.ts'), 'throw new Error("evaluated target");');
    writeFileSync(
      file,
      `throw new Error('evaluated manifest');
       export const remoteModule = { providers: [{
         token: 'test.root', placement: 'executor', role: 'root',
         modulePath: require.resolve('./implementation.ts'), exportName: 'Root'
       }] };`
    );
    expect(readRemoteManifest(file).providers[0].modulePath).toBe(
      join(directory, 'implementation.ts')
    );
    writeFileSync(file, 'export const remoteModule = (() => { throw new Error("evaluated"); })();');
    expect(() => readRemoteManifest(file)).toThrow('Invalid static remote declaration');
  } finally {
    rmSync(directory, { recursive: true });
  }
});

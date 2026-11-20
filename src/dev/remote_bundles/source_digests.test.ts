/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build, type Metafile } from 'esbuild';
import { digestRemoteSources } from '@kbn/core-remote-common';
import { collectRemoteSourceDigests } from './source_digests';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'remote-source-digest-'));
});

afterEach(() => {
  rmSync(directory, { force: true, recursive: true });
});

const contribution = {
  kind: 'core.savedObjects.types',
  stepType: 'example',
  modulePath: 'types.ts',
  exportName: 'createTypes',
};

const metafile = (): Metafile => ({
  inputs: {
    'types.ts': {
      bytes: 0,
      imports: [
        { path: 'node:crypto', kind: 'import-statement', external: true },
        { path: 'model.ts', kind: 'import-statement' },
        { path: 'deferred.ts', kind: 'dynamic-import' },
      ],
    },
    'model.ts': { bytes: 0, imports: [{ path: 'types.ts', kind: 'import-statement' }] },
    'deferred.ts': { bytes: 0, imports: [] },
    'unrelated.ts': { bytes: 0, imports: [] },
  },
  outputs: {},
});

it('hashes the complete original closure, including deferred imports, without evaluating code', () => {
  for (const path of ['types.ts', 'model.ts', 'deferred.ts']) {
    writeFileSync(join(directory, path), `throw new Error(${JSON.stringify(path)});\n`);
  }
  const [worker] = collectRemoteSourceDigests(metafile(), [contribution], directory);
  const coordinator = digestRemoteSources(
    worker.sources.map((path) => ({
      path,
      source: readFileSync(join(directory, path), 'utf8'),
    }))
  );
  expect(worker.digest).toBe(coordinator);
  expect(worker.sources).toEqual(['deferred.ts', 'model.ts', 'types.ts']);
  expect(worker).toMatchObject({
    kindId: 'core.savedObjects.types',
    contributionId: 'example',
    modulePath: 'types.ts',
    exportName: 'createTypes',
  });
  writeFileSync(join(directory, 'deferred.ts'), 'export const model = 2;');
  expect(collectRemoteSourceDigests(metafile(), [contribution], directory)[0].digest).not.toBe(
    worker.digest
  );
});

it('uses original TypeScript rather than output bytes and is independent of checkout location', async () => {
  const source = "export const createTypes = (): string => 'original';\n";
  writeFileSync(join(directory, 'types.ts'), source);
  const coordinator = digestRemoteSources([{ path: 'types.ts', source }]);
  for (const minify of [false, true]) {
    const result = await build({
      entryPoints: ['types.ts'],
      absWorkingDir: directory,
      outfile: join(directory, minify ? 'min.js' : 'full.js'),
      bundle: true,
      write: false,
      metafile: true,
      minify,
    });
    expect(collectRemoteSourceDigests(result.metafile, [contribution], directory)[0].digest).toBe(
      coordinator
    );
  }
});

it('refuses missing closure members and unverifiable external dependencies', () => {
  const missing = metafile();
  delete missing.inputs['model.ts'];
  expect(() => collectRemoteSourceDigests(missing, [contribution], directory)).toThrow(
    'Missing remote source input: model.ts'
  );
  const external = metafile();
  external.inputs['types.ts'].imports = [
    { path: 'unbundled-runtime', kind: 'import-statement', external: true },
  ];
  expect(() => collectRemoteSourceDigests(external, [contribution], directory)).toThrow(
    'Unverifiable external remote source'
  );
});

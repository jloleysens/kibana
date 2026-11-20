/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { Metafile } from 'esbuild';
import { measureStepChunks } from './step_chunk_sizes';

const output = (
  bytes: number,
  imports: Metafile['outputs'][string]['imports'] = [],
  entryPoint?: string
): Metafile['outputs'][string] => ({ bytes, imports, exports: [], inputs: {}, entryPoint });

it('counts exclusive transitive chunks, shared capabilities once per closure, and not dynamic loads', () => {
  const metafile: Metafile = {
    inputs: {},
    outputs: {
      'first.mjs': output(
        100,
        [
          { path: 'shared.mjs', kind: 'import-statement' },
          { path: 'private.mjs', kind: 'import-statement' },
          { path: 'lazy.mjs', kind: 'dynamic-import' },
          { path: 'node:fs', kind: 'import-statement', external: true },
        ],
        'first.ts'
      ),
      'second.mjs': output(200, [{ path: 'shared.mjs', kind: 'import-statement' }], 'second.ts'),
      'shared.mjs': output(1000),
      'private.mjs': output(300, [{ path: 'shared.mjs', kind: 'import-statement' }]),
      'lazy.mjs': output(5000, [], 'lazy.ts'),
    },
  };
  expect(
    measureStepChunks(metafile, [
      { stepType: 'first', modulePath: 'first.ts' },
      { stepType: 'second', modulePath: 'second.ts' },
    ])
  ).toEqual([
    {
      stepType: 'first',
      modulePath: 'first.ts',
      entryBytes: 100,
      exclusiveBytes: 400,
      sharedBytes: 1000,
    },
    {
      stepType: 'second',
      modulePath: 'second.ts',
      entryBytes: 200,
      exclusiveBytes: 200,
      sharedBytes: 1000,
    },
  ]);
});

it('does not mistake two operations from one implementation for two copies of its chunk', () => {
  const metafile: Metafile = { inputs: {}, outputs: { 'step.mjs': output(123, [], 'step.ts') } };
  const sizes = measureStepChunks(metafile, [
    { stepType: 'type.read', modulePath: 'step.ts' },
    { stepType: 'type.write', modulePath: 'step.ts' },
  ]);
  expect(sizes.map(({ exclusiveBytes }) => exclusiveBytes)).toEqual([123, 123]);
});

it('refuses missing entries and missing static dependencies rather than reporting zero bytes', () => {
  expect(() =>
    measureStepChunks({ inputs: {}, outputs: {} }, [
      { stepType: 'missing', modulePath: 'missing.ts' },
    ])
  ).toThrow('Missing bundled step entry');
  expect(() =>
    measureStepChunks(
      {
        inputs: {},
        outputs: {
          'step.mjs': output(123, [{ path: 'missing.mjs', kind: 'import-statement' }], 'step.ts'),
        },
      },
      []
    )
  ).toThrow('Missing bundled static dependency');
});

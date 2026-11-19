/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { Metafile } from 'esbuild';
import type { RemoteWorkerSpec } from '@kbn/core-remote-common';
import { measureShellInputs } from './shell_inputs';

const spec: RemoteWorkerSpec = {
  id: 'test',
  root: { tokenId: 'root', modulePath: 'core.ts', exportName: 'Core' },
  executorProviders: [{ tokenId: 'shell', modulePath: 'shell.ts', exportName: 'Shell' }],
  coordinatorTokenIds: [],
  contributions: [],
};
const metadata = (): Metafile => ({
  inputs: {
    'core.ts': { bytes: 100, imports: [] },
    'shell.ts': { bytes: 20, imports: [] },
    'shared.ts': { bytes: 50, imports: [] },
  },
  outputs: {
    'core.mjs': {
      bytes: 120,
      entryPoint: 'core.ts',
      exports: [],
      imports: [{ path: 'shared.mjs', kind: 'import-statement' }],
      inputs: { 'core.ts': { bytesInOutput: 100 } },
    },
    'shell.mjs': {
      bytes: 40,
      entryPoint: 'shell.ts',
      exports: [],
      imports: [{ path: 'shared.mjs', kind: 'import-statement' }],
      inputs: { 'shell.ts': { bytesInOutput: 20 } },
    },
    'shared.mjs': {
      bytes: 60,
      exports: [],
      imports: [],
      inputs: { 'shared.ts': { bytesInOutput: 50 } },
    },
  },
});

it('keeps source bytes stable when emitted shell bookkeeping grows', () => {
  const graph = metadata();
  expect(measureShellInputs(graph, spec, 'shell')).toEqual({
    inputs: ['shell.ts'],
    inputBytes: 20,
    emittedBytes: 40,
  });
  graph.outputs['shell.mjs'].bytes = 80;
  expect(measureShellInputs(graph, spec, 'shell')).toEqual({
    inputs: ['shell.ts'],
    inputBytes: 20,
    emittedBytes: 80,
  });
});

it('exposes a new exclusive dependency instead of hiding it in shared bytes', () => {
  const graph = metadata();
  graph.outputs['shell.mjs'].imports = [];
  expect(measureShellInputs(graph, spec, 'shell').inputs).toEqual(['shell.ts']);
  graph.outputs['shell.mjs'].inputs['heavy.ts'] = { bytesInOutput: 1000 };
  graph.inputs['heavy.ts'] = { bytes: 1000, imports: [] };
  expect(measureShellInputs(graph, spec, 'shell').inputs).toEqual(['heavy.ts', 'shell.ts']);
  expect(measureShellInputs(graph, spec, 'shell').inputBytes).toBe(1020);
});

it('refuses missing providers and source metadata', () => {
  expect(() => measureShellInputs(metadata(), spec, 'missing')).toThrow('Missing executor shell');
  const graph = metadata();
  delete graph.inputs['shell.ts'];
  expect(() => measureShellInputs(graph, spec, 'shell')).toThrow('Missing shell input');
});

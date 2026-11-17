/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { resolve } from 'node:path';
import { build } from 'esbuild';
import { ExecutionStatus, isTerminalStatus } from '@kbn/workflows-runtime';

it('keeps workflow runtime contracts free of authoring, schemas, catalogs, i18n and UI dependencies', async () => {
  const directory = resolve(__dirname, '../../platform/packages/shared/kbn-workflows-runtime');
  const result = await build({
    entryPoints: [resolve(directory, 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    metafile: true,
    write: false,
  });
  expect(Object.keys(result.metafile.inputs).map((path) => resolve(path))).toEqual([
    resolve(directory, 'index.ts'),
  ]);
  expect(isTerminalStatus(ExecutionStatus.COMPLETED)).toBe(true);
  expect(isTerminalStatus(ExecutionStatus.RUNNING)).toBe(false);
});

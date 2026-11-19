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

// Standalone static closures, not incremental graph bytes or real execution heap budgets.
// Node24/esbuild baselines: executor 13,767B; transport 1,208,866B; validation 825,359B.
it.each([
  ['single_file_connectors/create_spec_executor', 16 * 1024],
  ['create_axios_transport', 1.5 * 1024 * 1024],
  ['validate_action', 1024 * 1024],
] as const)('bounds the original %s shared capability closure', async (module, maxBytes) => {
  const result = await build({
    entryPoints: [
      resolve(
        __dirname,
        '../../../x-pack/platform/plugins/shared/actions/server/lib',
        `${module}.ts`
      ),
    ],
    bundle: true,
    platform: 'node',
    format: 'esm',
    metafile: true,
    write: false,
  });
  expect(
    result.outputFiles.reduce((total, file) => total + file.contents.length, 0)
  ).toBeLessThanOrEqual(maxBytes);
  const inputs = Object.keys(result.metafile.inputs);
  expect(inputs.some((path) => path.endsWith(`${module}.ts`))).toBe(true);
  expect(
    inputs.filter((path) =>
      /kbn-connector-specs\/|task_manager\/|node_modules\/(?:react(?:-dom)?\/|@elastic\/(?:eui|charts)\/|@emotion\/|lodash(?:-es)?\/(?:lodash|fp)\.js|lodash\/fp\/index\.js)/.test(
        path
      )
    )
  ).toEqual([]);
});

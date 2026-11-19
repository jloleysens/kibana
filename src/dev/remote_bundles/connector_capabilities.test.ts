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

it('keeps the approved eager spec-runtime shell tiny and defers every Actions implementation', async () => {
  const directory = resolve(
    __dirname,
    '../../../x-pack/platform/plugins/shared/actions/server/remote'
  );
  const result = await build({
    entryPoints: [resolve(directory, 'spec_runtime.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    metafile: true,
    external: ['inversify', '@kbn/core-di'],
    plugins: [
      {
        name: 'deferred-runtime-boundary',
        setup(builder) {
          builder.onResolve({ filter: /spec_runtime_impl$/ }, () => ({
            path: './spec_runtime_impl',
            external: true,
          }));
        },
      },
    ],
  });
  expect(Object.keys(result.metafile.inputs).sort()).toEqual(
    [resolve(directory, 'spec_runtime.ts'), resolve(directory, 'tokens.ts')]
      .map((path) => path.slice(resolve(__dirname, '../../..').length + 1))
      .sort()
  );
  expect(
    result.outputFiles.reduce((total, file) => total + file.contents.length, 0)
  ).toBeLessThanOrEqual(4096);
  expect(
    Object.values(result.metafile.inputs)
      .flatMap(({ imports }) => imports)
      .filter(({ kind }) => kind === 'dynamic-import')
  ).toEqual([
    expect.objectContaining({
      path: './spec_runtime_impl',
      kind: 'dynamic-import',
      external: true,
    }),
  ]);
});

it('bounds the shared native Actions capability without importing any connector implementation', async () => {
  const trackerImports: string[] = [];
  const result = await build({
    entryPoints: [
      resolve(
        __dirname,
        '../../../x-pack/platform/plugins/shared/actions/server/remote/spec_runtime_impl.ts'
      ),
    ],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    metafile: true,
    plugins: [
      {
        name: 'separately-budgeted-token-tracking-capability',
        setup(builder) {
          builder.onResolve(
            { filter: /^\.\.\/lib\/token_tracking\/gen_ai_token_tracking$/ },
            (args) => {
              trackerImports.push(args.kind);
              if (args.kind !== 'dynamic-import')
                throw new Error('Token tracking must remain a lazy capability');
              return { path: args.path, external: true };
            }
          );
        },
      },
    ],
  });
  expect(trackerImports).toEqual(['dynamic-import']);
  // Measured 5,608,160B standalone; ~21% headroom, independent of per-type budgets.
  expect(
    result.outputFiles.reduce((total, file) => total + file.contents.length, 0)
  ).toBeLessThanOrEqual(6.5 * 1024 * 1024);
  expect(
    Object.keys(result.metafile.inputs).filter((path) =>
      /all_specs|kbn-connector-specs\/src\/specs\/|\/lib\/relay\/relay_client\.ts|connector_relay_transport\.ts/.test(
        path
      )
    )
  ).toEqual([]);
});

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

import { build } from 'esbuild';
import { resolve } from 'node:path';

it('keeps action schemas in their separate Zod-only load-time cost class', async () => {
  const options = {
    platform: 'node' as const,
    format: 'esm' as const,
    bundle: true,
    write: false,
    metafile: true,
  };
  const { metafile } = await build({
    ...options,
    entryPoints: [
      resolve(__dirname, '../../platform/packages/shared/kbn-workflows-action-schema/index.ts'),
    ],
  });
  const zod = await build({ ...options, entryPoints: [require.resolve('@kbn/zod/v4')] });
  const inputs = Object.keys(metafile?.inputs ?? {});
  const zodInputs = new Set(Object.keys(zod.metafile?.inputs ?? {}));
  expect(inputs.filter((input) => !zodInputs.has(input))).toEqual([
    'src/platform/packages/shared/kbn-workflows-action-schema/index.ts',
  ]);
  expect(
    inputs.some((input) => /kbn-workflows\/|i18n|@elastic\/eui|node_modules\/react/.test(input))
  ).toBe(false);
});

it('keeps significant-event runtime scalars and errors free of every external input', async () => {
  const root = 'x-pack/platform/packages/shared/kbn-significant-events-runtime';
  const entry = `${root}/index.ts`;
  const { metafile } = await build({
    entryPoints: [resolve(entry)],
    bundle: true,
    platform: 'node',
    write: false,
    metafile: true,
  });
  expect(Object.keys(metafile?.inputs ?? {}).sort()).toEqual([
    entry,
    `${root}/nightshift_model_blocked_error.ts`,
    `${root}/nightshift_model_not_found_error.ts`,
  ]);
});

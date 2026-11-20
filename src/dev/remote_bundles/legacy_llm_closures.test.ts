/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { getJsSourceSync } from '@kbn/peggy';
import { measureStepChunks } from './step_chunk_sizes';

it('keeps original LLM factories free of coordinator barrels, UI, repository discovery and broad lodash', async () => {
  const types = ['openai', 'bedrock', 'gemini', 'inference'];
  const roots = types.map((type) => ({
    stepType: type === 'openai' ? 'gen-ai' : type,
    modulePath: resolve(
      __dirname,
      `../../../x-pack/platform/plugins/shared/stack_connectors/server/connector_types/${type}/index.ts`
    ),
  }));
  const result = await build({
    entryPoints: roots.map(({ modulePath }) => modulePath),
    outdir: '/tmp/legacy-llm-module-diagnostic',
    bundle: true,
    splitting: true,
    platform: 'node',
    format: 'esm',
    metafile: true,
    write: false,
    plugins: [
      {
        name: 'original-template-grammar',
        setup(builder) {
          builder.onLoad({ filter: /\.peggy$/ }, ({ path }) => ({
            contents: getJsSourceSync({
              path,
              content: readFileSync(path, 'utf8'),
              format: 'commonjs',
            }).source,
            loader: 'js',
          }));
        },
      },
    ],
  });
  expect(
    Object.keys(result.metafile.inputs).filter((path) =>
      /kbn-repo-(?:info|packages)|actions\/server\/index\.ts|task_manager\/server\/(?:index\.ts|task_running\/index\.ts)|node_modules\/(?:react(?:-dom)?\/|@elastic\/(?:eui|charts)\/|@emotion\/|lodash\/lodash\.js)/.test(
        path
      )
    )
  ).toEqual([]);
  const chunks = measureStepChunks(result.metafile, roots);
  expect(chunks.map(({ stepType }) => stepType)).toEqual([
    'gen-ai',
    'bedrock',
    'gemini',
    'inference',
  ]);
  // Reporting only: no native registration/execution, SDK heap or workflow-incremental size claim.
  process.stdout.write(`${JSON.stringify({ legacyLlmModuleOnly: chunks })}\n`);
}, 30_000);

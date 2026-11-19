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
import { getJsSourceSync } from '@kbn/peggy';
import { build } from 'esbuild';
import { ExecutionStatus, isTerminalStatus } from '@kbn/workflows-runtime';

it.each([
  'aggregate',
  'concat',
  'dedupe',
  'filter',
  'find',
  'map',
  'parse_json',
  'regex_extract',
  'regex_replace',
  'stringify_json',
])('keeps data_%s_runtime free of authoring and schema modules', async (step) => {
  const result = await build({
    entryPoints: [
      resolve(
        __dirname,
        '../../platform/plugins/shared/workflows_extensions/server/steps/data',
        `data_${step}_runtime.ts`
      ),
    ],
    bundle: true,
    platform: 'node',
    format: 'esm',
    metafile: true,
    write: false,
    plugins: [
      {
        name: 'peggy',
        setup(bundler) {
          bundler.onLoad({ filter: /\.peggy$/ }, ({ path }) => ({
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
  const inputs = Object.keys(result.metafile.inputs);
  expect(inputs).toContainEqual(expect.stringContaining(`data_${step}_runtime.ts`));
  expect(
    inputs.filter((path) =>
      /(?:node_modules\/(?:zod|joi)\/|@elastic\/eui|lodash\/lodash\.js|common\/steps\/.*_step\.ts)/.test(
        path
      )
    )
  ).toEqual([]);
});

it('keeps field conversion free of authoring schema construction', async () => {
  const result = await build({
    entryPoints: [
      resolve(
        __dirname,
        '../../platform/packages/shared/kbn-workflows/spec/lib/field_conversion.ts'
      ),
    ],
    bundle: true,
    platform: 'node',
    format: 'esm',
    metafile: true,
    write: false,
  });
  expect(
    Object.keys(result.metafile.inputs).filter((path) =>
      /(?:node_modules\/(?:zod|joi)\/|kbn-workflows\/spec\/schema\/.*_schema\.ts|kbn-i18n)/.test(
        path
      )
    )
  ).toEqual([]);
});

it('keeps workflow graph runtime free of the authoring schema closure', async () => {
  const result = await build({
    entryPoints: [
      resolve(__dirname, '../../platform/packages/shared/kbn-workflows/graph/index.ts'),
    ],
    bundle: true,
    platform: 'node',
    format: 'esm',
    metafile: true,
    write: false,
  });
  expect(
    Object.keys(result.metafile.inputs).filter((path) =>
      /(?:node_modules\/(?:zod|joi)\/|kbn-workflows\/spec\/schema|kbn-i18n|@elastic\/eui)/.test(
        path
      )
    )
  ).toEqual([]);
});

it('does not bundle the telemetry SDK for tracing suppression checks', async () => {
  const result = await build({
    entryPoints: [resolve(__dirname, '../../platform/packages/shared/kbn-tracing-utils/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    metafile: true,
    write: false,
  });
  expect(
    Object.keys(result.metafile.inputs).filter((path) =>
      /node_modules\/(?:@elastic\/opentelemetry-node|@opentelemetry\/(?:sdk-node|configuration))\//.test(
        path
      )
    )
  ).toEqual([]);
});

it('keeps template runtime limited to LiquidJS and its pure helpers', async () => {
  const directory = resolve(
    __dirname,
    '../../platform/packages/shared/kbn-workflows-template-runtime'
  );
  const result = await build({
    entryPoints: [resolve(directory, 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    metafile: true,
    write: false,
  });
  expect(
    Object.keys(result.metafile.inputs).filter(
      (path) =>
        !resolve(path).startsWith(directory + '/') && !path.startsWith('node_modules/liquidjs/')
    )
  ).toEqual([]);
});

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
  expect(
    Object.keys(result.metafile.inputs)
      .map((path) => resolve(path))
      .sort()
  ).toEqual(
    [
      'index',
      'parse_js_property_access',
      'execution_error',
      'kibana_api_call_error',
      'kibana_http',
      'duration',
      'pick_workflow_document_version',
      'well_known_trigger_sources',
      'elasticsearch_request_builder',
      'loop_step_types',
      'poll_step_defaults',
      'hitl_defaults',
    ]
      .map((name) => resolve(directory, `${name}.ts`))
      .sort()
  );
  expect(isTerminalStatus(ExecutionStatus.COMPLETED)).toBe(true);
  expect(isTerminalStatus(ExecutionStatus.RUNNING)).toBe(false);
});

it('keeps connector execution helpers free of catalogs, schemas, SDKs and UI', async () => {
  const result = await build({
    entryPoints: [
      resolve(__dirname, '../../platform/packages/shared/kbn-connector-specs-runtime/index.ts'),
    ],
    bundle: true,
    platform: 'node',
    format: 'esm',
    metafile: true,
    write: false,
  });
  const inputs = Object.keys(result.metafile.inputs);
  expect(inputs.length).toBeGreaterThan(0);
  expect(inputs.every((path) => path.includes('/kbn-connector-specs-runtime/'))).toBe(true);
  expect(
    inputs.filter((path) =>
      /all_specs|all_auth_types|node_modules|kbn-connector-specs\//.test(path)
    )
  ).toEqual([]);
});

it('keeps the original spec executor independent of default SDK and Task Manager services', async () => {
  const result = await build({
    entryPoints: [
      resolve(
        __dirname,
        '../../../x-pack/platform/plugins/shared/actions/server/lib/single_file_connectors/create_spec_executor.ts'
      ),
    ],
    bundle: true,
    platform: 'node',
    format: 'esm',
    metafile: true,
    write: false,
  });
  const inputs = Object.keys(result.metafile.inputs);
  expect(inputs).toContainEqual(expect.stringContaining('/create_spec_executor.ts'));
  expect(
    inputs.filter((path) =>
      /node_modules|kbn-connector-specs\/|task_manager\/|get_axios_instance|generate_executor_function/.test(
        path
      )
    )
  ).toEqual([]);
});

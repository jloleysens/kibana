/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { buildRemoteBundle } from './build';
import { discoverRemoteManifests } from './discover';

it('bounds original attack-discovery validation algorithms without loading coordinator authentication or live connector policy', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'attack-discovery-validation-budgets-'));
  try {
    const bundle = await buildRemoteBundle({
      manifests: discoverRemoteManifests(resolve(__dirname, '../../..')),
      graph: {
        id: 'workflows',
        root: 'workflows.executor',
        dependencies: ['workflows.stepCatalog'],
        contributions: ['workflows.step', 'workflows.connector'],
      },
      outdir: join(directory, 'bundle'),
    });
    for (const suffix of [
      '/discoveries/server/remote/operations.ts',
      '/discoveries/server/workflows/steps/default_validation_step/get_default_validation_step_definition.ts',
      '/discoveries/server/workflows/steps/default_validation_step/helpers/authenticate_and_get_space.ts',
    ])
      expect(bundle.inputs.some((path) => path.endsWith(suffix))).toBe(false);
    const probe = join(directory, 'probe.mjs');
    await build({
      entryPoints: [
        resolve(
          __dirname,
          '../../../x-pack/solutions/security/plugins/discoveries/server/remote/fixtures/validation_execution_probe.ts'
        ),
      ],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: probe,
    });
    for (let index = 0; index < 3; index++) {
      const result = JSON.parse(
        execFileSync(process.execPath, ['--expose-gc', probe, dirname(bundle.entry)], {
          encoding: 'utf8',
        })
      ) as { heapIncrement: number };
      process.stdout.write(JSON.stringify({ attackDiscoveryValidationCurve: result }) + '\n');
      expect(result.heapIncrement).toBeLessThanOrEqual(2 * 1024 * 1024);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60000);

it('bounds remaining original attack-discovery thin handlers without loading oversized graph/persistence or live scoped services', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'attack-discovery-generation-budgets-'));
  try {
    const bundle = await buildRemoteBundle({
      manifests: discoverRemoteManifests(resolve(__dirname, '../../..')),
      graph: {
        id: 'workflows',
        root: 'workflows.executor',
        dependencies: ['workflows.stepCatalog'],
        contributions: ['workflows.step', 'workflows.connector'],
      },
      outdir: join(directory, 'bundle'),
    });
    for (const suffix of [
      '/discoveries/server/remote/operations.ts',
      '/discoveries/server/workflows/steps/generate_step/prepare_generation.ts',
      '/discoveries/server/workflows/steps/persist_discoveries_step/persist_discoveries.ts',
      '/discoveries/server/workflows/steps/run_step/prepare_run.ts',
      '/discoveries/server/workflows/steps/generate_step/helpers/invoke_generation_graph.ts',
      '/discoveries/server/workflows/steps/default_validation_step/helpers/authenticate_and_get_space.ts',
    ])
      expect(bundle.inputs.some((path) => path.endsWith(suffix))).toBe(false);
    const probe = join(directory, 'probe.mjs');
    await build({
      entryPoints: [
        resolve(
          __dirname,
          '../../../x-pack/solutions/security/plugins/discoveries/server/remote/fixtures/remaining_execution_probe.ts'
        ),
      ],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: probe,
    });
    for (const action of ['generate', 'persistDiscoveries', 'run'])
      for (let index = 0; index < 3; index++) {
        const result = JSON.parse(
          execFileSync(process.execPath, ['--expose-gc', probe, dirname(bundle.entry), action], {
            encoding: 'utf8',
          })
        ) as { heapIncrement: number };
        process.stdout.write(JSON.stringify({ attackDiscoveryThinCurve: result }) + '\n');
        expect(result.heapIncrement).toBeLessThanOrEqual(2 * 1024 * 1024);
      }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60000);

// Inference references the parser in source, but its current emitted static closure excludes it.
const esqlParser = {
  consumers: ['storage-adapter ES|QL', 'attack-discovery retrieval'],
  heapBytes: 6_500_000,
  loadedBytes: 1_530_000,
  medianMs: 55,
} as const;

it('bounds shared esqlParser and the original native retrieval first ES response above that baseline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'attack-discovery-esql-parser-'));
  try {
    const probes = join(directory, 'parser_manifest.ts');
    writeFileSync(
      probes,
      'export const remoteModule = ' +
        JSON.stringify({
          contributions: [
            {
              kind: 'workflows.esqlParserProbe',
              stepType: 'esqlParser.injectMetadataId',
              modulePath: resolve(
                __dirname,
                '../../../x-pack/solutions/security/packages/kbn-securitysolution-esql-runtime/index.ts'
              ),
              exportName: 'injectMetadataId',
            },
            {
              kind: 'workflows.esqlParserProbe',
              stepType: 'esqlParser.correctQueryWithAst',
              modulePath: resolve(
                __dirname,
                '../../../x-pack/platform/plugins/shared/inference/common/tasks/nl_to_esql/ast/correct_with_ast.ts'
              ),
              exportName: 'correctQueryWithAst',
            },
          ],
        }) +
        ';'
    );
    const bundle = await buildRemoteBundle({
      manifests: [...discoverRemoteManifests(resolve(__dirname, '../../..')), probes],
      graph: {
        id: 'workflows',
        root: 'workflows.executor',
        dependencies: ['workflows.stepCatalog'],
        contributions: ['workflows.step', 'workflows.connector', 'workflows.esqlParserProbe'],
      },
      outdir: join(directory, 'bundle'),
    });
    const metadata: import('esbuild').Metafile = JSON.parse(
      readFileSync(join(dirname(bundle.entry), 'metafile.json'), 'utf8')
    );
    const directConsumers = Object.entries(metadata.inputs)
      .filter(
        ([file, input]) =>
          !file.startsWith('node_modules/') &&
          input.imports.some((entry) => entry.path === 'node_modules/@elastic/esql/lib/index.mjs')
      )
      .map(([file]) => file)
      .sort();
    expect(directConsumers).toEqual([
      'src/platform/packages/shared/kbn-storage-adapter/src/index_adapter/index.ts',
      'x-pack/platform/plugins/shared/inference/common/tasks/nl_to_esql/ast/ast_tools/timespan.ts',
      'x-pack/platform/plugins/shared/inference/common/tasks/nl_to_esql/ast/correct_with_ast.ts',
      'x-pack/platform/plugins/shared/inference/common/tasks/nl_to_esql/ast/corrections/like.ts',
      'x-pack/platform/plugins/shared/inference/common/tasks/nl_to_esql/ast/corrections/timespan_literals.ts',
      'x-pack/solutions/security/packages/kbn-securitysolution-esql-runtime/inject_metadata_id.ts',
    ]);
    const inferenceOutput = Object.entries(metadata.outputs).find(([, output]) =>
      Object.keys(output.inputs).some((input) =>
        input.endsWith('/inference/server/remote/worker_inference.ts')
      )
    );
    expect(inferenceOutput).toBeDefined();
    if (!inferenceOutput) throw new Error('Missing inference output');
    const loaded = new Set<string>();
    const visit = (file: string): void => {
      if (loaded.has(file)) return;
      loaded.add(file);
      for (const entry of metadata.outputs[file]?.imports ?? [])
        if (entry.kind === 'import-statement' && !entry.external) visit(entry.path);
    };
    visit(inferenceOutput[0]);
    for (const file of loaded)
      for (const [input, details] of Object.entries(metadata.outputs[file].inputs))
        if (details.bytesInOutput > 0)
          expect(input).not.toMatch(/(?:node_modules\/@elastic\/esql\/|\/correct_with_ast\.ts$)/);
    const probe = join(directory, 'probe.mjs');
    await build({
      entryPoints: [
        resolve(
          __dirname,
          '../../../x-pack/solutions/security/plugins/discoveries/server/remote/fixtures/retrieval_execution_probe.ts'
        ),
      ],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: probe,
    });
    const times: number[] = [];
    for (let index = 0; index < 3; index++) {
      const result = JSON.parse(
        execFileSync(process.execPath, ['--expose-gc', probe, dirname(bundle.entry)], {
          encoding: 'utf8',
        })
      ) as { parserHeap: number; parserBytes: number; parserMs: number; retrievalHeap: number };
      process.stdout.write(
        JSON.stringify({ esqlParserCurve: result, consumers: esqlParser.consumers }) + '\n'
      );
      expect(result.parserHeap).toBeLessThanOrEqual(esqlParser.heapBytes);
      expect(result.parserBytes).toBeLessThanOrEqual(esqlParser.loadedBytes);
      expect(result.retrievalHeap).toBeLessThanOrEqual(2 * 1024 * 1024);
      times.push(result.parserMs);
    }
    expect(times.sort((left, right) => left - right)[1]).toBeLessThanOrEqual(esqlParser.medianMs);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60000);

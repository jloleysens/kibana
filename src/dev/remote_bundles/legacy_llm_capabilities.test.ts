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

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { buildRemoteBundle } from './build';
import { discoverRemoteManifests } from './discover';

const capabilities = [
  {
    path: 'stack_connectors/server/connector_types/openai/openai_sdk.ts',
    bytes: 1024 * 1024,
    heap: 5 * 1024 * 1024,
  },
  {
    path: 'stack_connectors/server/connector_types/bedrock/bedrock_sdk.ts',
    bytes: 1.5 * 1024 * 1024,
    heap: 4 * 1024 * 1024,
  },
  { path: 'actions/server/lib/google_auth_sdk.ts', bytes: 1024 * 1024, heap: 1.5 * 1024 * 1024 },
  {
    path: 'actions/server/lib/token_tracking/gen_ai_token_tracking.ts',
    bytes: 1.75 * 1024 * 1024,
    heap: 10 * 1024 * 1024,
  },
];

it.each(capabilities)(
  'bounds the lazy capability $path without coordinator/UI/broad lodash inputs',
  async ({ path, bytes }) => {
    const result = await build({
      entryPoints: [resolve(__dirname, '../../../x-pack/platform/plugins/shared', path)],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      metafile: true,
    });
    expect(
      result.outputFiles.reduce((sum, file) => sum + file.contents.length, 0)
    ).toBeLessThanOrEqual(bytes);
    expect(
      Object.keys(result.metafile.inputs).filter((file) =>
        /kbn-repo-(?:info|packages)|actions\/server\/index\.ts|node_modules\/(?:react(?:-dom)?\/|@elastic\/(?:eui|charts)\/|@emotion\/|lodash\/lodash\.js)/.test(
          file
        )
      )
    ).toEqual([]);
  }
);

it('bounds first-use SDK client construction and original token tracking in the actual split graph', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'legacy-llm-capabilities-'));
  try {
    await buildRemoteBundle({
      manifests: discoverRemoteManifests(resolve(__dirname, '../../..')),
      graph: {
        id: 'workflows',
        root: 'workflows.executor',
        dependencies: ['workflows.stepCatalog'],
        contributions: ['workflows.step', 'workflows.connector'],
      },
      outdir: join(directory, 'bundle'),
    });
    const probe = join(directory, 'probe.mjs');
    await build({
      entryPoints: [resolve(__dirname, '__fixtures__/legacy_llm_capability_probe.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: probe,
    });
    for (let index = 0; index < 3; index++) {
      const result = JSON.parse(
        execFileSync(process.execPath, ['--expose-gc', probe, join(directory, 'bundle')], {
          encoding: 'utf8',
        })
      ) as { rows: Array<{ path: string; heapIncrement: number; ms: number }> };
      for (const { path, heap } of capabilities) {
        const sample = result.rows.find((row) => path.endsWith(row.path.replace(/^\//, '')));
        expect(sample).toBeDefined();
        expect(sample?.heapIncrement).toBeLessThanOrEqual(heap);
        expect(sample?.ms).toBeLessThanOrEqual(100);
      }
      process.stdout.write(`${JSON.stringify({ legacyLlmCapabilities: result })}\n`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);

it('keeps all four legacy types within the unchanged 2MiB real-execution heap ceiling', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'legacy-llm-execution-'));
  try {
    await buildRemoteBundle({
      manifests: discoverRemoteManifests(resolve(__dirname, '../../..')),
      graph: {
        id: 'workflows',
        root: 'workflows.executor',
        dependencies: ['workflows.stepCatalog'],
        contributions: ['workflows.step', 'workflows.connector'],
      },
      outdir: join(directory, 'bundle'),
    });
    const probe = join(directory, 'probe.mjs');
    await build({
      entryPoints: [resolve(__dirname, '__fixtures__/legacy_llm_execution_probe.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: probe,
      banner: {
        js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
      },
    });
    for (let index = 0; index < 3; index++) {
      const result = JSON.parse(
        execFileSync(process.execPath, ['--expose-gc', probe, join(directory, 'bundle')], {
          encoding: 'utf8',
        })
      ) as {
        results: Array<{ type: string; heapIncrement: number; requests: number }>;
        prepares: number;
        finalized: number;
      };
      expect(result.results.map(({ type }) => type)).toEqual([
        'gen-ai',
        'bedrock',
        'gemini',
        'inference',
      ]);
      for (const row of result.results) {
        expect(row.heapIncrement).toBeLessThanOrEqual(2 * 1024 * 1024);
        expect(row.requests).toBe(1);
      }
      expect(result.prepares).toBe(4);
      expect(result.finalized).toBe(4);
      process.stdout.write(`${JSON.stringify({ legacyLlmTypeCurve: result })}\n`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);

it('executes original streaming handlers against local HTTP/TLS/CONNECT fakes and drains both tee branches', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'legacy-llm-streaming-'));
  try {
    const probe = join(directory, 'probe.mjs');
    const bundle = await build({
      entryPoints: [resolve(__dirname, '__fixtures__/legacy_llm_streaming_probe.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: probe,
      metafile: true,
      banner: {
        js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
      },
    });
    expect(
      Object.keys(bundle.metafile.inputs).filter((path) =>
        /actions\/server\/lib\/action_executor\.ts|workflow_step_runner\.ts/.test(path)
      )
    ).toEqual([]);
    const result = JSON.parse(
      execFileSync(process.execPath, [probe], { encoding: 'utf8', timeout: 15_000 })
    ) as { pid: number; requests: number; drainedBranches: number[] };
    expect(result.pid).not.toBe(process.pid);
    expect(result.requests).toBe(4);
    expect(result.drainedBranches).toEqual([2, 2, 1, 2]);
    process.stdout.write(`${JSON.stringify({ legacyLlmStreamingFixture: result })}\n`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);

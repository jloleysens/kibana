/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Metafile } from 'esbuild';
import { buildRemoteBundle } from './build';
import { discoverRemoteManifests } from './discover';

// Local Node24/macOS PoC baselines: 9,851,499 bundle bytes; ~70MiB post-GC RSS.
// Total bytes are reporting-only; idle and per-step/capability first-use costs remain gated.
const BUNDLE_REPORTING_CEILING_BYTES = 11_000_000;
const MAX_IDLE_RSS_BYTES = 80 * 1024 * 1024;

it('reports bundle bytes and bounds the idle host without loading steps or authoring', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-budgets-'));
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
    process.stdout.write(
      `${JSON.stringify({
        bundleBytes: bundle.bytes,
        reportingCeilingBytes: BUNDLE_REPORTING_CEILING_BYTES,
        exceedsReportingCeiling: bundle.bytes > BUNDLE_REPORTING_CEILING_BYTES,
      })}\n`
    );
    const probe = join(directory, 'probe.cjs');
    const hook = join(directory, 'hook.mjs');
    const loads = join(directory, 'loads.jsonl');
    await build({
      entryPoints: [
        resolve(
          __dirname,
          '../../core/packages/remote/server-internal/src/__fixtures__/probe_bundle.ts'
        ),
      ],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: probe,
    });
    await build({
      entryPoints: [resolve(__dirname, '__fixtures__/module_load_hook.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: hook,
    });
    interface IdleSample {
      memory: { gcAvailable: boolean; usage: { rss: number } };
      implementationRoots: string[];
    }
    const clean = JSON.parse(
      execFileSync(process.execPath, [probe, dirname(bundle.entry)], { encoding: 'utf8' })
    ) as { samples: IdleSample[] };
    expect(clean.samples).toHaveLength(3);
    const coreRoots = [
      bundle.spec.root,
      ...bundle.spec.executorProviders,
      ...(bundle.spec.catalog ? [bundle.spec.catalog] : []),
    ].map(({ modulePath }) => modulePath);
    for (const sample of clean.samples) {
      expect(sample.memory.gcAvailable).toBe(true);
      expect(sample.memory.usage.rss).toBeLessThanOrEqual(MAX_IDLE_RSS_BYTES);
      expect(sample.implementationRoots.sort()).toEqual(coreRoots.slice().sort());
    }
    execFileSync(process.execPath, [probe, dirname(bundle.entry)], {
      env: { ...process.env, RUNNER_LOAD_HOOK: hook, RUNNER_LOAD_LOG: loads },
    });
    const metafile = JSON.parse(
      readFileSync(join(dirname(bundle.entry), 'metafile.json'), 'utf8')
    ) as Metafile;
    const outputs = new Map(
      Object.entries(metafile.outputs).map(([path, output]) => [realpathSync(path), output])
    );
    const loadedInputs = new Set<string>();
    for (const line of readFileSync(loads, 'utf8').trim().split('\n')) {
      const { url } = JSON.parse(line) as { url: string };
      const output = outputs.get(realpathSync(fileURLToPath(url)));
      for (const [path, input] of Object.entries(output?.inputs ?? {})) {
        if (input.bytesInOutput > 0) loadedInputs.add(path);
      }
    }
    expect(loadedInputs.size).toBeGreaterThan(0);
    expect(
      [...loadedInputs].filter((path) =>
        /(?:workflows-template-runtime|liquidjs|node_modules\/(?:zod|joi)\/|kbn-i18n|server\/step\/|server\/steps\/data\/data_.*_runtime\.ts)/.test(
          path
        )
      )
    ).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);

it.each([
  '@elastic/eui/index.js',
  '@elastic/charts/index.js',
  '@emotion/react/index.js',
  'react/index.js',
  'react-dom/index.js',
  'lodash/lodash.js',
  'lodash-es/lodash.js',
  'lodash/fp.js',
])('refuses forbidden worker dependency %s', async (dependency) => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-forbidden-'));
  try {
    const module = join(directory, 'node_modules', dependency);
    mkdirSync(dirname(module), { recursive: true });
    writeFileSync(module, 'export const value = 1;');
    writeFileSync(
      join(directory, 'root.ts'),
      `export { value as Root } from ${JSON.stringify(module)};`
    );
    const manifest = join(directory, 'index.ts');
    writeFileSync(
      manifest,
      `export const remoteModule = { providers: [{ token: 'root', role: 'root', placement: 'executor', modulePath: require.resolve('./root.ts'), exportName: 'Root' }] };`
    );
    await expect(
      buildRemoteBundle({
        manifests: [manifest],
        graph: { id: 'forbidden', root: 'root', dependencies: [], contributions: [] },
        outdir: join(directory, 'bundle'),
      })
    ).rejects.toThrow('Forbidden worker inputs');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it('refuses an oversized lazy step exclusive closure without increasing global or idle budgets', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-step-budget-'));
  try {
    writeFileSync(join(directory, 'root.ts'), 'export class Root {}');
    writeFileSync(
      join(directory, 'payload.ts'),
      `export const payload = '${'x'.repeat(256 * 1024)}';`
    );
    writeFileSync(
      join(directory, 'step.ts'),
      "import { payload } from './payload'; export class Step { run() { return payload; } }"
    );
    const manifest = join(directory, 'index.ts');
    writeFileSync(
      manifest,
      `export const remoteModule = {
      providers: [{ token: 'root', role: 'root', placement: 'executor', modulePath: require.resolve('./root.ts'), exportName: 'Root' }],
      contributions: [{ kind: 'step', stepType: 'oversized', modulePath: require.resolve('./step.ts'), exportName: 'Step' }]
    };`
    );
    const outdir = join(directory, 'bundle');
    await expect(
      buildRemoteBundle({
        manifests: [manifest],
        graph: { id: 'step-budget', root: 'root', dependencies: [], contributions: ['step'] },
        outdir,
      })
    ).rejects.toThrow('Worker step exclusive chunks exceed 262144 bytes');
    const sizes = JSON.parse(readFileSync(join(outdir, 'step_chunks.json'), 'utf8')) as Array<{
      stepType: string;
      exclusiveBytes: number;
    }>;
    expect(sizes).toEqual([
      {
        stepType: 'oversized',
        exclusiveBytes: expect.any(Number),
        entryBytes: expect.any(Number),
        modulePath: expect.any(String),
        sharedBytes: expect.any(Number),
      },
    ]);
    expect(sizes[0].exclusiveBytes).toBeGreaterThan(256 * 1024);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { buildRemoteBundle } from './build';
import { discoverRemoteManifests } from './discover';

it('bounds original KI and feedback handlers without loading coordinator registry, revision or verifier services', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'context-engine-budgets-'));
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
    const probe = join(directory, 'probe.mjs');
    await build({
      entryPoints: [resolve(__dirname, '__fixtures__/context_engine_execution_probe.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: probe,
    });
    expect(
      bundle.inputs.some((path) =>
        path.endsWith('/context_engine/server/feedback_analysis/context.ts')
      )
    ).toBe(false);
    expect(
      bundle.inputs.some((path) => path.endsWith('/context_engine/server/improvements/service.ts'))
    ).toBe(false);
    for (const coordinatorModule of [
      '/server/ai_indices/ki_revision.ts',
      '/server/remote/ki_operations.ts',
      '/server/step_types/verify_ki.ts',
      '/server/step_types/record_improvements_operation.ts',
      '/server/feedback_analysis/record_improvements.ts',
    ]) {
      expect(
        bundle.inputs.some((path) => path.endsWith('/context_engine' + coordinatorModule))
      ).toBe(false);
    }
    const kiProbe = join(directory, 'ki_probe.mjs');
    await build({
      entryPoints: [resolve(__dirname, '__fixtures__/context_engine_ki_execution_probe.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: kiProbe,
    });
    for (const action of ['createKi', 'updateKi', 'deleteKi', 'verifyKi', 'recordImprovements']) {
      for (let index = 0; index < 3; index++) {
        const result = JSON.parse(
          execFileSync(process.execPath, ['--expose-gc', kiProbe, dirname(bundle.entry), action], {
            encoding: 'utf8',
          })
        ) as { events: Array<{ action: string; heapIncrement: number }> };
        process.stdout.write(JSON.stringify({ contextEngineKiCurve: result }) + '\n');
        expect(result.events.map(({ action: measuredAction }) => measuredAction)).toEqual([action]);
        for (const event of result.events)
          expect(event.heapIncrement).toBeLessThanOrEqual(2 * 1024 * 1024);
      }
    }
    for (let index = 0; index < 3; index++) {
      const result = JSON.parse(
        execFileSync(process.execPath, ['--expose-gc', probe, dirname(bundle.entry)], {
          encoding: 'utf8',
        })
      ) as {
        sdkHeap: number;
        events: Array<{ hasSignals: boolean; ms: number; heapIncrement: number }>;
      };
      process.stdout.write(`${JSON.stringify({ contextEngineCurve: result })}\n`);
      // Existing original scoped ES first response, then the native handler with an explicit typed-service fixture.
      expect(result.sdkHeap).toBeLessThanOrEqual(5_600_000);
      expect(result.events.map(({ hasSignals }) => hasSignals)).toEqual([true, false]);
      for (const event of result.events)
        expect(event.heapIncrement).toBeLessThanOrEqual(2 * 1024 * 1024);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);

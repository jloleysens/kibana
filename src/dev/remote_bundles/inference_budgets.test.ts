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

it.each([false, true])(
  'bounds the shared original inference first execution and each original endpoint-backed handler (optimizers=%s)',
  async (optimizers) => {
    const directory = mkdtempSync(join(tmpdir(), 'inference-budgets-'));
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
        entryPoints: [resolve(__dirname, '__fixtures__/inference_execution_probe.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: probe,
      });
      for (let index = 0; index < 3; index++) {
        const result = JSON.parse(
          execFileSync(
            process.execPath,
            ['--expose-gc', probe, dirname(bundle.entry), ...(optimizers ? ['--optimizers'] : [])],
            {
              encoding: 'utf8',
            }
          )
        ) as {
          sharedBytes: number;
          sharedHeap: number;
          sharedMs: number;
          events: Array<{ type: string; heapIncrement: number; ms: number; requests: number }>;
          requests: number;
        };
        process.stdout.write(`${JSON.stringify({ inferenceCurve: result })}\n`);
        // Original client + LangChain + shared byte-size parsing, including the first real model response.
        expect(result.sharedHeap).toBeLessThanOrEqual(36 * 1024 * 1024);
        expect(result.sharedBytes).toBeLessThanOrEqual(11_500_000);
        expect(result.sharedMs).toBeLessThanOrEqual(300);
        expect(result.events.map(({ type }) => type)).toEqual([
          'ai.prompt',
          'ai.prompt',
          'ai.summarize',
          'ai.classify',
          ...(optimizers ? ['nightshift.cortexOptimize', 'nightshift.memoryOptimize'] : []),
        ]);
        for (const event of result.events) {
          expect(event.heapIncrement).toBeLessThanOrEqual(2 * 1024 * 1024);
          expect(event.requests).toBe(1);
        }
        expect(result.requests).toBe(optimizers ? 7 : 5);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  60_000
);

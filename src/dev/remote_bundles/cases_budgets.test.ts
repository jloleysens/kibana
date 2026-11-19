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
import { nearestRank } from './load_statistics';

it('bounds shared Cases validation including its first valid response and exclusive original step execution', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cases-budgets-'));
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
      entryPoints: [resolve(__dirname, '__fixtures__/cases_execution_probe.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: probe,
    });
    const sharedLatencies: number[] = [];
    for (let index = 0; index < 3; index++) {
      const result = JSON.parse(
        execFileSync(process.execPath, ['--expose-gc', probe, dirname(bundle.entry)], {
          encoding: 'utf8',
        })
      ) as {
        sharedHeap: number;
        sharedBytes: number;
        sharedMs: number;
        events: Array<{ type: string; heapIncrement: number; operations: string[] }>;
      };
      process.stdout.write(`${JSON.stringify({ casesCurve: result })}\n`);
      // Measured8.43MB /1.539MB JS /54ms; first valid response initializes lazy schema parsers.
      expect(result.sharedHeap).toBeLessThanOrEqual(9 * 1024 * 1024);
      expect(result.sharedBytes).toBeLessThanOrEqual(1_700_000);
      sharedLatencies.push(result.sharedMs);
      expect(result.events.map(({ type }) => type)).toEqual([
        'cases.createCase',
        'cases.updateCase',
        'cases.addComment',
        'cases.findCases',
        'cases.getCase',
      ]);
      expect(result.events.map(({ operations }) => operations)).toEqual([
        ['create'],
        ['get', 'bulkUpdate'],
        ['get', 'attachmentAdd'],
        ['find'],
        ['get'],
      ]);
      for (const event of result.events)
        expect(event.heapIncrement).toBeLessThanOrEqual(2 * 1024 * 1024);
    }
    expect(nearestRank(sharedLatencies, 0.5)).toBeLessThanOrEqual(65);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);

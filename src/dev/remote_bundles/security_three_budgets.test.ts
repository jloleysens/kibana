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

it('bounds original Security entity, exception-filter and fingerprint step first executions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'security-three-budgets-'));
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
      entryPoints: [resolve(__dirname, '__fixtures__/security_three_execution_probe.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: probe,
    });
    const sharedLatencies: number[] = [];
    const entitiesLatencies: number[] = [];
    for (let index = 0; index < 3; index++) {
      const result = JSON.parse(
        execFileSync(process.execPath, ['--expose-gc', probe, dirname(bundle.entry)], {
          encoding: 'utf8',
        })
      ) as {
        sharedHeap: number;
        sharedMs: number;
        sharedBytes: number;
        entitiesHeap: number;
        entitiesMs: number;
        entitiesBytes: number;
        events: Array<{ type: string; heapIncrement: number; ms: number }>;
      };
      process.stdout.write(`${JSON.stringify({ securityCurve: result })}\n`);
      // Original native ES service, then shared entity-resolution first valid Painless/parse response.
      expect(result.sharedHeap).toBeLessThanOrEqual(5_600_000);
      expect(result.sharedBytes).toBeLessThanOrEqual(2_800_000);
      expect(result.entitiesHeap).toBeLessThanOrEqual(6_800_000);
      expect(result.entitiesBytes).toBeLessThanOrEqual(1_560_000);
      sharedLatencies.push(result.sharedMs);
      entitiesLatencies.push(result.entitiesMs);
      expect(result.events.map(({ type }) => type)).toEqual([
        'security.getAlertEntities',
        'security.buildExceptionEntriesFilter',
        'security.matchAttackFingerprints',
      ]);
      for (const event of result.events) {
        expect(event.heapIncrement).toBeLessThanOrEqual(2 * 1024 * 1024);
      }
    }
    expect(nearestRank(sharedLatencies, 0.5)).toBeLessThanOrEqual(45);
    expect(nearestRank(entitiesLatencies, 0.5)).toBeLessThanOrEqual(45);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);

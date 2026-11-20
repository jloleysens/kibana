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

it('bounds original significant-events thin handlers without loading ESQL classification or live model policy', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'significant-events-budgets-'));
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
      '/significant_events/server/step_definitions/classify_detections.ts',
      '/significant_events/server/step_definitions/resolve_model.ts',
      '/significant_events/server/remote/operations.ts',
      '/significant_events/server/lib/significant_events/events/rule_events_client.ts',
    ])
      expect(bundle.inputs.some((path) => path.endsWith(suffix))).toBe(false);
    const probe = join(directory, 'probe.mjs');
    await build({
      entryPoints: [
        resolve(
          __dirname,
          '../../../x-pack/solutions/observability/plugins/significant_events/server/remote/fixtures/execution_probe.ts'
        ),
      ],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: probe,
    });
    for (const action of ['resolveModel', 'classifyDetections'])
      for (let index = 0; index < 3; index++) {
        const result = JSON.parse(
          execFileSync(process.execPath, ['--expose-gc', probe, dirname(bundle.entry), action], {
            encoding: 'utf8',
          })
        ) as { heapIncrement: number };
        process.stdout.write(JSON.stringify({ significantEventsCurve: result }) + '\n');
        expect(result.heapIncrement).toBeLessThanOrEqual(2 * 1024 * 1024);
      }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60000);

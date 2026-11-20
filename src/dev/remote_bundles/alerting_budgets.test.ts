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

it('bounds the original alert-event algorithms without loading privileged query, storage, or resource readiness', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'alerting-create-alert-budgets-'));
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
      '/alerting_v2/server/remote/storage.ts',
      '/alerting_v2/server/lib/alert_events_client/alert_events_client.ts',
      '/alerting_v2/server/lib/alert_events_client/alert_event_storage.ts',
      '/alerting_v2/server/lib/services/query_service/query_service.ts',
      '/alerting_v2/server/lib/services/storage_service/storage_service.ts',
      '/alerting_v2/server/lib/services/resource_service/resource_manager.ts',
    ])
      expect(bundle.inputs.some((path) => path.endsWith(suffix))).toBe(false);
    expect(
      bundle.inputs.some((path) =>
        path.endsWith('/alerting_v2/server/lib/alert_events_client/alert_event_algorithms.ts')
      )
    ).toBe(true);
    const chunk = bundle.stepChunks.find(({ stepType }) => stepType === 'alerting.create_alert');
    expect(chunk?.exclusiveBytes).toBeLessThanOrEqual(256 * 1024);
    const probe = join(directory, 'probe.mjs');
    await build({
      entryPoints: [
        resolve(
          __dirname,
          '../../../x-pack/platform/plugins/shared/alerting_v2/server/remote/fixtures/create_alert_execution_probe.ts'
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
      process.stdout.write(JSON.stringify({ alertingCreateAlertCurve: result }) + '\n');
      expect(result.heapIncrement).toBeLessThanOrEqual(2 * 1024 * 1024);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 120000);

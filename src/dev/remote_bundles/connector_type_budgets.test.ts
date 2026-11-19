/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { build, type Metafile } from 'esbuild';
import { buildRemoteBundle } from './build';
import { discoverRemoteManifests } from './discover';

it('bounds first business execution of each simple-auth spec and the shared MCP capability', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'connector-types-'));
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
      entryPoints: [resolve(__dirname, '__fixtures__/connector_type_execution_probe.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: probe,
    });
    const metadata: Metafile = JSON.parse(
      readFileSync(join(dirname(bundle.entry), 'metafile.json'), 'utf8')
    );
    const mcp = Object.values(metadata.outputs).find((output) =>
      Object.keys(output.inputs).some((path) => path.endsWith('/lib/mcp/with_mcp_client.ts'))
    );
    // ~479KiB lazy shared MCP implementation, excluding already-owned Actions/Zod chunks.
    expect(mcp?.bytes).toBeLessThanOrEqual(640 * 1024);
    for (let index = 0; index < 3; index++) {
      const result = JSON.parse(
        execFileSync(process.execPath, ['--expose-gc', probe, dirname(bundle.entry)], {
          encoding: 'utf8',
        })
      ) as {
        samples: Array<{ phase: string; heapUsed: number }>;
        events: Array<{ type: string; heapIncrement: number; requests: number }>;
        sharedMs: number;
        mcpMs: number;
        prepares: number;
        finalizes: number[];
      };
      const [core, shell, actions, mcpSample] = result.samples;
      expect(shell.heapUsed - core.heapUsed).toBeLessThanOrEqual(32 * 1024);
      expect(actions.heapUsed - shell.heapUsed).toBeLessThanOrEqual(20 * 1024 * 1024);
      // Measured ~2.85MiB lazy shared MCP import, with explicit headroom.
      expect(mcpSample.heapUsed - actions.heapUsed).toBeLessThanOrEqual(4 * 1024 * 1024);
      expect(result.mcpMs).toBeLessThanOrEqual(500);
      expect(result.events.map(({ type }) => type)).toEqual([
        'jenkins',
        'rootly',
        'unifi',
        'buildkite',
        'dynatrace',
        'grafana',
        'new_relic',
        'prometheus',
        'sentry',
        'datadog',
        'censys',
        'pagerduty_mcp',
      ]);
      for (const event of result.events) {
        expect(event.heapIncrement).toBeLessThanOrEqual(2 * 1024 * 1024);
        expect(event.requests).toBeGreaterThan(0);
      }
      expect(result.prepares).toBe(12);
      expect(result.finalizes).toEqual([12]);
      process.stdout.write(`${JSON.stringify({ connectorTypeCurve: result })}\n`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);

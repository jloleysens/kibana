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

it('keeps seven legacy SubAction types within the unchanged 2MiB real-execution heap ceiling', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'legacy-connector-execution-'));
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
      entryPoints: [resolve(__dirname, '__fixtures__/legacy_connector_execution_probe.ts')],
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
        'd3security',
        'opsgenie',
        'jira-service-management',
        'tines',
        'xsoar',
        'resilient',
        'thehive',
      ]);
      for (const row of result.results) {
        expect(row.heapIncrement).toBeLessThanOrEqual(2 * 1024 * 1024);
        expect(row.requests).toBe(1);
      }
      expect(result.prepares).toBe(7);
      expect(result.finalized).toBe(7);
      process.stdout.write(`${JSON.stringify({ legacyConnectorTypeCurve: result })}\n`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);

it('bounds all twenty-one remaining legacy families during original network execution', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'legacy-all-execution-'));
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
      entryPoints: [resolve(__dirname, '__fixtures__/connector_type_execution_probe.ts')],
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
        execFileSync(
          process.execPath,
          ['--expose-gc', probe, join(directory, 'bundle'), '--legacy'],
          { encoding: 'utf8' }
        )
      ) as {
        events: Array<{ type: string; heapIncrement: number; requests: number }>;
        prepares: number;
        finalizes: number[];
      };
      expect(result.events.map(({ type }) => type)).toEqual([
        'd3security',
        'opsgenie',
        'jira-service-management',
        'tines',
        'xsoar',
        'resilient',
        'thehive',
        'http',
        'email',
        'slack',
        'slack_api',
        'teams',
        'pagerduty',
        'torq',
        'xmatters',
        'jira',
        'servicenow',
        'servicenow-itom',
        'servicenow-sir',
        'swimlane',
        'mcp',
      ]);
      for (const event of result.events) {
        expect(event.heapIncrement).toBeLessThanOrEqual(2 * 1024 * 1024);
        expect(event.requests).toBeGreaterThan(0);
      }
      expect(result.prepares).toBe(21);
      expect(result.finalizes).toEqual([21]);
      process.stdout.write(JSON.stringify({ legacyConnectorCurve: result }) + '\n');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);

it('bounds the lazy original SMTP/Markdown capability independently of thin email execution', async () => {
  const source = resolve(
    __dirname,
    '../../../x-pack/platform/plugins/shared/stack_connectors/server/connector_types/email/send_email.ts'
  );
  const bytes = await build({
    entryPoints: [source],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    metafile: true,
  });
  expect(
    bytes.outputFiles.reduce((sum, file) => sum + file.contents.length, 0)
  ).toBeLessThanOrEqual(5 * 1024 * 1024);
  expect(
    Object.keys(bytes.metafile.inputs).filter((path) =>
      /actions\/server\/index\.ts|kbn-repo-(?:info|packages)|node_modules\/(?:react(?:-dom)?\/|@elastic\/(?:eui|charts)\/|@emotion\/|lodash\/lodash\.js)/.test(
        path
      )
    )
  ).toEqual([]);
  const directory = mkdtempSync(join(tmpdir(), 'legacy-email-capability-'));
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
      entryPoints: [resolve(__dirname, '__fixtures__/legacy_connector_capability_probe.ts')],
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
      const email = result.rows.find(({ path }) => path.endsWith('/email/send_email.ts'));
      expect(email).toBeDefined();
      expect(email?.heapIncrement).toBeLessThanOrEqual(3 * 1024 * 1024);
      expect(email?.ms).toBeLessThanOrEqual(100);
      process.stdout.write(JSON.stringify({ legacyEmailCapability: result }) + '\n');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);

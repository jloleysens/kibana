/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { resolve } from 'node:path';
import { buildRemoteBundle } from './build';
import { discoverRemoteManifests } from './discover';

const main = async (): Promise<void> => {
  const [id = 'workflows', directory = '.scratch/runner-poc/bundle'] = process.argv.slice(2);
  if (id !== 'workflows') throw new Error(`Unknown registered graph: ${id}`);
  const result = await buildRemoteBundle({
    manifests: discoverRemoteManifests(process.cwd()),
    graph: {
      id,
      root: 'workflows.executor',
      dependencies: ['workflows.stepCatalog'],
      contributions: ['workflows.step', 'workflows.connector'],
    },
    outdir: resolve(directory),
    sourceDigestKinds: ['core.savedObjects.types'],
    // Reporting only: measured SO/uiSettings union 12,687,273 bytes, plus ~10% headroom.
    reportingCeilingBytes: 14_000_000,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};

main().catch((error: Error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});

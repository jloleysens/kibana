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
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0, the GNU Affero General Public License v3.0 only, or the Server Side
 * Public License, v 1.
 */

import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import type { RemoteWorkerSpec } from '@kbn/core-remote-common';

interface Graph {
  spec: RemoteWorkerSpec;
  implementations: Record<string, () => Promise<Record<string, object>>>;
}

const main = async (): Promise<void> => {
  const directory = resolve(process.argv[2]);
  const graph: Graph = await import(pathToFileURL(join(directory, 'graph.mjs')).href);
  const shell = graph.spec.executorProviders.find(
    ({ tokenId }) => tokenId === 'actions.specRuntime'
  );
  assert(shell);
  for (const root of [
    graph.spec.root,
    ...graph.spec.executorProviders.filter((provider) => provider !== shell),
    graph.spec.catalog,
  ]) {
    if (root) await graph.implementations[root.modulePath]();
  }
  const sample = async (): Promise<number> => {
    assert(global.gc);
    await delay(10);
    global.gc();
    await delay(10);
    global.gc();
    return process.memoryUsage().heapUsed;
  };
  const before = await sample();
  await graph.implementations[shell.modulePath]();
  const after = await sample();
  process.stdout.write(JSON.stringify({ pid: process.pid, before, after, delta: after - before }));
};

main().catch((error: Error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});

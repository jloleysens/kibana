/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import type { Metafile } from 'esbuild';
const dir = resolve(process.argv[2]);
const m: Metafile = JSON.parse(readFileSync(dir + '/metafile.json', 'utf8'));
const rows = [];
const sample = () => {
  assert(global.gc);
  global.gc();
  return process.memoryUsage();
};
const files = ['/remote/spec_runtime_impl.ts', '/email/send_email.ts'];
for (const path of files) {
  const found = Object.entries(m.outputs).find(([, v]) => v.entryPoint?.endsWith(path));
  assert(found, path);
  const [p] = found;
  const before = sample();
  const start = performance.now();
  const exports = await import(pathToFileURL(resolve(p)).href);
  assert(exports);
  const ms = performance.now() - start;
  await new Promise((r) => setImmediate(r));
  const after = sample();
  rows.push({
    path,
    ms,
    heapIncrement: after.heapUsed - before.heapUsed,
    rssIncrement: after.rss - before.rss,
    before,
    after,
    scope: 'import only; real SMTP transport construction/execution separately guarded',
  });
}
process.stdout.write(JSON.stringify({ pid: process.pid, rows }));

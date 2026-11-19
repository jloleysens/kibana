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

import { execFileSync } from 'node:child_process';
import { nearestRank } from './load_statistics';

interface ShellHeapSample {
  pid: number;
  before: number;
  after: number;
  delta: number;
}

interface ShellHeapMeasurement {
  method: string;
  samples: ShellHeapSample[];
  median: number;
  min: number;
  max: number;
  spread: number;
}

/** Isolates each shell-import sample from business fixtures and their deferred initialization. */
export const measureShellHeap = (probe: string, bundleDirectory: string): ShellHeapMeasurement => {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const samples = Array.from(
    { length: 5 },
    () =>
      JSON.parse(
        execFileSync(process.execPath, ['--expose-gc', probe, bundleDirectory], {
          encoding: 'utf8',
          env,
        })
      ) as ShellHeapSample
  );
  const deltas = samples.map(({ delta }) => delta);
  return {
    method: 'fresh-process-per-sample; engine baseline only; settle10ms+GC twice before/after',
    samples,
    median: nearestRank(deltas, 0.5),
    min: Math.min(...deltas),
    max: Math.max(...deltas),
    spread: Math.max(...deltas) - Math.min(...deltas),
  };
};

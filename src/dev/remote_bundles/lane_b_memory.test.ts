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

import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorySnapshot } from './lane_b_measurements';

it('reports retired nested hosts separately instead of signalling missing PIDs or hiding their last samples', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lane-b-memory-'));
  const sample = (pid: number, event: string) => ({
    pid,
    ppid: 101,
    at: Date.now(),
    event,
    memory: { rss: 10, heapUsed: 5 },
  });
  writeFileSync(
    join(directory, 'process-101.jsonl'),
    JSON.stringify(sample(101, 'initial')) + '\n'
  );
  writeFileSync(
    join(directory, 'process-102.jsonl'),
    JSON.stringify(sample(102, 'initial')) + '\n'
  );
  const kill = jest.spyOn(process, 'kill').mockImplementation((pid) => {
    if (pid === 102) throw Object.assign(new Error('Process retired'), { code: 'ESRCH' });
    appendFileSync(join(directory, 'process-101.jsonl'), JSON.stringify(sample(101, 'gc')) + '\n');
    return true;
  });
  try {
    await expect(memorySnapshot(directory, 101)).resolves.toMatchObject({
      combinedRss: 10,
      combinedHeap: 5,
      processes: [expect.objectContaining({ pid: 101 })],
      retiredLastSamples: [expect.objectContaining({ pid: 102 })],
    });
  } finally {
    kill.mockRestore();
    rmSync(directory, { recursive: true });
  }
});

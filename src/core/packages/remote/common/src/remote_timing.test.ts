/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordRemoteTiming } from './remote_timing';

it('records only scalar measurement fields, never excess credential/payload properties', () => {
  const directory = mkdtempSync(join(tmpdir(), 'remote-timing-'));
  const previous = process.env.KBN_REMOTE_TIMING_LOG;
  try {
    const path = join(directory, 'timing.jsonl');
    process.env.KBN_REMOTE_TIMING_LOG = path;
    const context = {
      executionId: 'run',
      durationMs: 1.25,
      atEpochMs: 123,
      authorization: 'must-never-appear',
      payload: { secret: 'must-never-appear' },
    };
    recordRemoteTiming('step_start', context);
    const line = readFileSync(path, 'utf8');
    expect(JSON.parse(line)).toEqual({
      event: 'step_start',
      at: 123,
      pid: process.pid,
      threadId: 0,
      isMainThread: true,
      executionId: 'run',
      durationMs: 1.25,
    });
    expect(line).not.toContain('must-never-appear');
  } finally {
    if (previous === undefined) delete process.env.KBN_REMOTE_TIMING_LOG;
    else process.env.KBN_REMOTE_TIMING_LOG = previous;
    rmSync(directory, { recursive: true });
  }
});

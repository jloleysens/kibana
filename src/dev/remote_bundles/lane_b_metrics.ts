/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

/** Installs harness-only process sampling; SIGUSR2 explicitly records an acknowledged post-GC sample. */
export const installLaneBMetrics = (directory: string): void => {
  const sample = (event: 'start' | 'interval' | 'gc') => {
    if (event === 'gc') {
      if (!global.gc) throw new Error('Memory profile requires --expose-gc');
      global.gc();
    }
    appendFileSync(
      join(directory, `process-${process.pid}.jsonl`),
      `${JSON.stringify({
        event,
        at: Date.now(),
        pid: process.pid,
        ppid: process.ppid,
        argv: process.argv,
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
      })}\n`
    );
  };
  sample('start');
  setInterval(() => sample('interval'), 100).unref();
  process.on('SIGUSR2', () => sample('gc'));
};

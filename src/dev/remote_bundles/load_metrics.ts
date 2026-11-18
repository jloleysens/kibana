/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';

// Explicit harness-only preload. Signal the HTTP listener, not its development launcher.
const histogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();
let cpu = process.cpuUsage();
let utilisation = performance.eventLoopUtilization();
let started = Date.now();
const snapshot = () => {
  const now = Date.now();
  const elapsedCpu = process.cpuUsage(cpu);
  const elapsedUtilisation = performance.eventLoopUtilization(utilisation);
  writeFileSync(
    `${process.env.KBN_LOAD_METRICS}.${process.pid}.json`,
    JSON.stringify(
      {
        pid: process.pid,
        started,
        finished: now,
        cpu: elapsedCpu,
        utilisation: elapsedUtilisation,
        rss: process.memoryUsage().rss,
        delayMs: {
          p50: histogram.percentile(50) / 1e6,
          p99: histogram.percentile(99) / 1e6,
          max: histogram.max / 1e6,
        },
      },
      null,
      2
    )
  );
  histogram.reset();
  cpu = process.cpuUsage();
  utilisation = performance.eventLoopUtilization();
  started = now;
};
snapshot();
process.on('SIGUSR2', snapshot);

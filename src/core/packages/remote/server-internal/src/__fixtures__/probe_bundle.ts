/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { RpcTarget } from 'capnweb';
import type { RemoteWorkerSpec } from '@kbn/core-remote-common';
import { graphSignature } from '../graph_signature';
import { openIpcSession } from '../ipc_session';

class IdleGateway extends RpcTarget {
  getCapability(): RpcTarget {
    return new RpcTarget();
  }
}

interface Probe {
  loadedModules(): Promise<string[]>;
  memoryUsage(): Promise<{ pid: number; gcAvailable: boolean; usage: NodeJS.MemoryUsage }>;
}

const main = async (): Promise<void> => {
  const directory = resolve(process.argv[2]);
  const spec: RemoteWorkerSpec = JSON.parse(readFileSync(join(directory, 'spec.json'), 'utf8'));
  const samples = [];
  for (let index = 0; index < 3; index++) {
    const requested = performance.timeOrigin + performance.now();
    const child = fork(join(directory, 'graph.mjs'), [], {
      execArgv: [
        '--expose-gc',
        ...(process.env.RUNNER_LOAD_HOOK ? ['--import', process.env.RUNNER_LOAD_HOOK] : []),
      ],
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    const timeout = setTimeout(() => child.kill(), 15000);
    const session = openIpcSession<Probe>(child, new IdleGateway());
    try {
      await new Promise<void>((resolveReady, reject) => {
        const finish = (error?: Error) => {
          child.off('message', onMessage);
          child.off('exit', onExit);
          child.off('error', finish);
          if (error) reject(error);
          else resolveReady();
        };
        const onMessage = (message: { kind?: string; message?: string }) => {
          if (message.kind === 'boot-error') finish(new Error(message.message));
          if (message.kind === 'ready') finish();
        };
        const onExit = () => finish(new Error('Probe child exited before ready'));
        child.on('message', onMessage);
        child.once('exit', onExit);
        child.once('error', finish);
        child.send({ kind: 'init', signature: graphSignature(spec) });
      });
      const ready = performance.timeOrigin + performance.now();
      await delay(100);
      const memory = await session.remote.memoryUsage();
      const implementationRoots = await session.remote.loadedModules();
      samples.push({ requested, ready, memory, implementationRoots });
    } finally {
      clearTimeout(timeout);
      session.close();
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    }
  }
  process.stdout.write(`${JSON.stringify({ node: process.version, samples }, null, 2)}\n`);
};

main().catch((error: Error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});

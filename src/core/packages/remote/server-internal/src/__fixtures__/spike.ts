/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { Container, inject, injectable } from 'inversify';
import { RpcTarget } from 'capnweb';
import { openIpcSession } from '../ipc_session';
import { Greeting, GreetingToken } from './spike_greeting';

@injectable()
class Engine extends RpcTarget {
  constructor(@inject(GreetingToken) private readonly greeting: Greeting) {
    super();
  }

  async run(): Promise<{ value: string; received: number; usage: NodeJS.MemoryUsage }> {
    const received = performance.timeOrigin + performance.now();
    global.gc?.();
    return { value: this.greeting.value(), received, usage: process.memoryUsage() };
  }
}

const main = async (): Promise<void> => {
  if (process.send) {
    const container = new Container();
    container.bind(GreetingToken).to(Greeting);
    container.bind(Engine).toSelf();
    const session = openIpcSession(
      {
        send: process.send.bind(process),
        on: process.on.bind(process),
        off: process.off.bind(process),
      },
      container.get(Engine)
    );
    process.once('disconnect', () => session.close());
    process.send({ kind: 'ready' });
    return;
  }
  const samples = [];
  for (let index = 0; index < 5; index++) {
    const requested = performance.timeOrigin + performance.now();
    const child = fork(__filename, [], {
      execArgv: ['--expose-gc'],
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    const deadline = setTimeout(() => child.kill(), 10000);
    const session = openIpcSession<Engine>(child);
    try {
      // The session ignores out-of-band readiness frames.
      for (;;) {
        const [message] = await once(child, 'message');
        if (message.kind === 'ready') break;
      }
      const ready = performance.timeOrigin + performance.now();
      const result = await session.remote.run();
      const finished = performance.timeOrigin + performance.now();
      assert.equal(result.value, 'explicit injection survived bundling');
      const warmRequested = performance.timeOrigin + performance.now();
      const warm = await session.remote.run();
      const warmFinished = performance.timeOrigin + performance.now();
      samples.push({ requested, ready, finished, ...result, warmRequested, warmFinished, warm });
    } finally {
      clearTimeout(deadline);
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

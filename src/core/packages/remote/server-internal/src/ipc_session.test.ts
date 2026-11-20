/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildSync } from 'esbuild';
import { expose } from '@kbn/core-remote-common';
import { openIpcSession } from './ipc_session';
import { SessionTarget } from './__fixtures__/session_target';

interface Reply {
  kind: string;
  stats?: { imports: number; exports: number };
}

const reply = (child: ChildProcess, kind: string): Promise<Reply> =>
  new Promise((resolve) => {
    const listener = (message: Reply) => {
      if (message.kind !== kind) return;
      child.off('message', listener);
      resolve(message);
    };
    child.on('message', listener);
  });

describe('openIpcSession', () => {
  it('multiplexes a real fork and returns both capability tables to the post-boot baseline', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ipc-session-'));
    const outfile = join(directory, 'child.cjs');
    buildSync({
      entryPoints: [join(__dirname, '__fixtures__/session_child.ts')],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
    });
    const child = fork(outfile, [], {
      execArgv: ['--expose-gc'],
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    const session = openIpcSession<SessionTarget>(child, expose(new SessionTarget()));
    try {
      const ready = reply(child, 'ready');
      child.send({ kind: 'init' });
      await ready;
      const before = reply(child, 'probe-result');
      child.send({ kind: 'probe' });
      const baseline = (await before).stats;
      const localBaseline = session.getStats();
      expect(baseline).toBeDefined();
      for (let run = 0; run < 3; run++) {
        const capability = await session.remote.child();
        await expect(capability.identity('native-data-stays-local')).resolves.toBe(
          'native-data-stays-local'
        );
        capability[Symbol.dispose]();
        await session.drain();
        // drain() waits for calls, not transport delivery of asynchronous release frames.
        const deadline = Date.now() + 1000;
        let stats: Reply['stats'];
        do {
          const after = reply(child, 'probe-result');
          child.send({ kind: 'probe' });
          stats = (await after).stats;
          if (JSON.stringify(stats) === JSON.stringify(baseline)) break;
          await delay(10);
        } while (Date.now() < deadline);
        expect(stats).toEqual(baseline);
        expect(session.getStats()).toEqual(localBaseline);
      }
    } finally {
      session.close();
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill();
      await exited;
      rmSync(directory, { recursive: true });
    }
  }, 15000);
});

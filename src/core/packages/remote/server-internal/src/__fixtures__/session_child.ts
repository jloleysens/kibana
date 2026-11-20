/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { expose } from '@kbn/core-remote-common';
import { openIpcSession } from '../ipc_session';
import type { IpcSession } from '../ipc_session';
import { SessionTarget } from './session_target';

const { send } = process;
if (!send) throw new Error('Session fixture requires a fork channel');
const channel = {
  send: send.bind(process),
  on: process.on.bind(process),
  off: process.off.bind(process),
};
let session: IpcSession<SessionTarget> | undefined;
process.on('message', async (message: { kind: string; session?: boolean }) => {
  if (message.kind === 'init') {
    if (message.session !== false)
      session = openIpcSession<SessionTarget>(channel, expose(new SessionTarget()));
    channel.send({ kind: 'ready', pid: process.pid });
  }
  if (message.kind === 'probe') {
    await session?.drain();
    global.gc?.();
    channel.send({
      kind: 'probe-result',
      stats: session?.getStats(),
      usage: process.memoryUsage(),
      pid: process.pid,
    });
  }
});

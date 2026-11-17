/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { RpcSession } from 'capnweb';
import type { RpcCompatible, RpcStub } from 'capnweb';
import { IpcTransport } from './ipc_transport';
import type { IpcChannel } from './ipc_transport';

export interface IpcSession<Remote extends RpcCompatible<Remote> = undefined> {
  readonly remote: RpcStub<Remote>;
  getStats(): { imports: number; exports: number };
  drain(): Promise<void>;
  close(): void;
}

/** Opens one RPC session for the lifetime of an existing fork channel. */
export const openIpcSession = <Remote extends RpcCompatible<Remote> = undefined>(
  channel: IpcChannel,
  localMain?: object
): IpcSession<Remote> => {
  const transport = new IpcTransport(channel);
  const session = new RpcSession<Remote>(transport, localMain);
  return {
    remote: session.getRemoteMain(),
    getStats: () => session.getStats(),
    drain: () => session.drain(),
    close: () => transport.abort(new Error('Remote IPC session ended')),
  };
};

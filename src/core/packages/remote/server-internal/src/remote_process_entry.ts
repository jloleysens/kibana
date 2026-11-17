/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { RemoteWorkerSpec } from '@kbn/core-remote-common';
import { buildExecutor } from './build_executor';
import { createBridge } from './executor_bridge';
import { openIpcSession } from './ipc_session';
import { graphSignature } from './graph_signature';

interface CoordinatorApi {
  getCapability(tokenId: string): object;
}

export type ImplementationImports = Readonly<Record<string, () => Promise<Record<string, object>>>>;

/** Hosts a statically bundled graph; no source transpiler or plugin discovery runs in the child. */
export const serveProcess = (
  spec: RemoteWorkerSpec,
  implementations: ImplementationImports
): void => {
  const { send } = process;
  if (!send) throw new Error('Remote process host requires fork IPC');
  const channel = {
    send: send.bind(process),
    on: process.on.bind(process),
    off: process.off.bind(process),
  };
  const bridge = createBridge();
  const session = openIpcSession<CoordinatorApi>(channel, bridge.rpc);
  process.once('disconnect', () => {
    session.close();
    process.exitCode = 0;
  });
  const onInit = async (message: { kind: string; signature: string }): Promise<void> => {
    if (message.kind !== 'init') return;
    process.off('message', onInit);
    try {
      if (message.signature !== graphSignature(spec)) {
        throw new Error('Remote bundle registration mismatch');
      }
      const coordinator = new Map(
        spec.coordinatorTokenIds.map((tokenId) => [tokenId, session.remote.getCapability(tokenId)])
      );
      const loaded: string[] = [];
      const executor = await buildExecutor(spec, coordinator, loaded, async (path, exportName) => {
        const load = implementations[path];
        if (!load) throw new Error(`Implementation absent from worker bundle: ${path}`);
        const implementation = (await load())[exportName];
        if (!implementation) throw new Error(`Missing bundled export: ${exportName}`);
        loaded.push(path);
        return implementation;
      });
      bridge.attach(executor, loaded);
      channel.send({ kind: 'ready' });
    } catch (error) {
      channel.send({
        kind: 'boot-error',
        message: error instanceof Error ? error.message : String(error),
      });
      session.close();
      process.disconnect();
      process.exitCode = 1;
    }
  };
  process.on('message', onInit);
};

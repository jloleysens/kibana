/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { workerData, type MessagePort } from 'node:worker_threads';
import { openPortSession } from '@kbn/core-remote-common';
import type { RemoteWorkerSpec } from '@kbn/core-remote-common';
import { buildExecutor } from './build_executor';
import { createBridge } from './executor_bridge';

interface CoordinatorApi {
  getCapability(tokenId: string): unknown;
}

/**
 * Application readiness. The managed-worker bootstrap awaits this before reporting ready,
 * so the graph exists before the coordinator accepts calls.
 */
export async function ready(): Promise<void> {
  const data = workerData as { __connectionPort?: MessagePort; data: RemoteWorkerSpec };
  if (!data.__connectionPort) {
    throw new Error('Remote worker was started without a connection port');
  }
  const spec = data.data;
  const bridge = createBridge();
  const coordinator = openPortSession<CoordinatorApi>(data.__connectionPort, bridge.rpc);
  const values = new Map<string, unknown>();
  for (const tokenId of spec.coordinatorTokenIds) {
    values.set(tokenId, coordinator.getCapability(tokenId));
  }
  const loaded: string[] = [];
  const executor = await buildExecutor(spec, values, loaded);
  bridge.attach(executor, loaded);
}

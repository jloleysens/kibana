/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License, v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  getRemoteLeaseParent,
  registerRemoteLeaseParents,
  withRemoteLeaseParent,
} from '@kbn/core-remote-server';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { RemoteLeasePool } from './remote_lease_pool';

it('invalidates capacity ancestry for background work that outlives its coordinator invocation', async () => {
  let hosts = 0;
  const pool = new RemoteLeasePool(
    async () => ({ value: ++hosts, alive: () => true, close: async () => {} }),
    { maxAgeMs: 60_000, maxRuns: 100 }
  );
  const lease = await pool.acquire('', undefined, { runId: 'parent' });
  const controller = new AbortController();
  const scopes: ScopeLookup = {
    get: jest.fn(),
    getRunState: jest.fn().mockReturnValue({ workflowRunId: 'parent' }),
    getAbortSignal: () => controller.signal,
    resolveStepType: jest.fn(),
    resolveStepOutputLimit: jest.fn(),
    admitChild: jest.fn(),
  };
  registerRemoteLeaseParents(scopes, () => ({
    token: lease.parentToken,
    signal: controller.signal,
  }));
  const proceed = Promise.withResolvers<void>();
  let background: Promise<{ value: number; release: () => Promise<void> }> | undefined;
  try {
    await withRemoteLeaseParent(scopes, 'scope', async () => {
      const active = getRemoteLeaseParent();
      expect(active?.runId).toBe('parent');
      const nested = await pool.acquire('', undefined, { runId: 'nested', parent: active });
      expect(nested.value).not.toBe(lease.value);
      await nested.release();
      background = proceed.promise.then(() => {
        expect(getRemoteLeaseParent()).toBeUndefined();
        return pool.acquire('', undefined, { runId: 'late', parent: getRemoteLeaseParent() });
      });
    });
    expect(getRemoteLeaseParent()).toBeUndefined();
    proceed.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    expect(hosts).toBe(2);
    await lease.release();
    const late = await background;
    expect(late?.value).toBe(lease.value);
    await late?.release();
  } finally {
    await lease.release();
    await pool.stop();
  }
});

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { RemoteLeasePool } from './remote_lease_pool';

const setup = (policy = { maxAgeMs: 1000, maxRuns: 2 }) => {
  let now = 0;
  let alive = true;
  const closed: number[] = [];
  let created = 0;
  const create = jest.fn(async () => {
    const id = ++created;
    return {
      value: id,
      close: async () => {
        closed.push(id);
      },
      alive: () => alive,
    };
  });
  const pool = new RemoteLeasePool(create, policy, () => now);
  return {
    pool,
    create,
    closed,
    advance: (ms: number) => {
      now += ms;
    },
    crash: () => {
      alive = false;
    },
  };
};

it('serializes concurrent leases and reuses a compatible warm host', async () => {
  const { pool, create } = setup();
  await pool.warm();
  const first = await pool.acquire('settings');
  const granted = jest.fn();
  const waiting = pool.acquire('settings').then((lease) => {
    granted();
    return lease;
  });
  await Promise.resolve();
  expect(granted).not.toHaveBeenCalled();
  await first.release();
  const second = await waiting;
  expect(second.value).toBe(first.value);
  expect(create).toHaveBeenCalledTimes(1);
  await second.release();
  await pool.stop();
});

it.each(['runs', 'age', 'settings', 'crash', 'discard'] as const)(
  'retires for %s',
  async (reason) => {
    const state = setup();
    const first = await state.pool.acquire('a');
    await first.release(reason === 'discard');
    if (reason === 'runs') {
      const second = await state.pool.acquire('a');
      await second.release();
    }
    if (reason === 'age') state.advance(1000);
    if (reason === 'crash') state.crash();
    const next = await state.pool.acquire(reason === 'settings' ? 'b' : 'a');
    expect(next.value).not.toBe(first.value);
    expect(state.closed).toEqual([first.value]);
    await next.release();
    await state.pool.stop();
  }
);

it('removes aborted waiters without stealing the next lease', async () => {
  const { pool } = setup();
  const first = await pool.acquire('a');
  const abort = new AbortController();
  const waiting = pool.acquire('a', abort.signal);
  const rejected = expect(waiting).rejects.toThrow('aborted');
  abort.abort();
  await rejected;
  await first.release();
  const next = await pool.acquire('a');
  expect(next.value).toBe(first.value);
  await next.release();
  await pool.stop();
});

it('rejects queued and future leases during stop and closes the active host once', async () => {
  const { pool, closed } = setup();
  const active = await pool.acquire('a');
  const waiting = pool.acquire('a');
  const rejected = expect(waiting).rejects.toThrow('stopped');
  await pool.stop();
  await rejected;
  await expect(pool.acquire('a')).rejects.toThrow('stopped');
  await active.release(true);
  await active.release();
  await pool.stop();
  expect(closed).toEqual([active.value]);
});

it('retries creation failures without stranding the lease queue', async () => {
  const create = jest
    .fn()
    .mockRejectedValueOnce(new Error('boot failed'))
    .mockResolvedValue({
      value: 1,
      close: async () => undefined,
      alive: () => true,
    });
  const pool = new RemoteLeasePool(create, { maxAgeMs: 1000, maxRuns: 10 });
  await expect(pool.acquire('a')).rejects.toThrow('boot failed');
  const lease = await pool.acquire('a');
  expect(lease.value).toBe(1);
  await lease.release();
  await pool.stop();
});

it('shares startup with a lease arriving before readiness', async () => {
  let complete: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const create = jest.fn(async () => {
    await gate;
    return { value: 1, close: async () => undefined, alive: () => true };
  });
  const pool = new RemoteLeasePool(create, { maxAgeMs: 1000, maxRuns: 10 });
  const warming = pool.warm();
  const pending = pool.acquire('a');
  complete();
  await warming;
  const lease = await pending;
  expect(create).toHaveBeenCalledTimes(1);
  await lease.release();
  await pool.stop();
});

it('releases the slot when an acquisition is cancelled while its host is still booting', async () => {
  let complete: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const create = jest.fn(async () => {
    await gate;
    return { value: 1, close: async () => undefined, alive: () => true };
  });
  const pool = new RemoteLeasePool(create, { maxAgeMs: 1000, maxRuns: 10 });
  const controller = new AbortController();
  const cancelled = pool.acquire('a', controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error('task cancelled'));
  await expect(cancelled).rejects.toThrow('task cancelled');

  // The pool still owns the in-flight startup; the next caller gets the shared host.
  const next = pool.acquire('a');
  complete();
  const lease = await next;
  expect(lease.value).toBe(1);
  expect(create).toHaveBeenCalledTimes(1);
  await lease.release();
  await pool.stop();
});

it('closes a host that finishes booting after stop', async () => {
  let complete: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const close = jest.fn(async () => undefined);
  const pool = new RemoteLeasePool(
    async () => {
      await gate;
      return { value: 1, close, alive: () => true };
    },
    { maxAgeMs: 1000, maxRuns: 10 }
  );
  const warming = pool.warm();
  const rejected = expect(warming).rejects.toThrow('stopped');
  const stopping = pool.stop();
  complete();
  await rejected;
  await stopping;
  expect(close).toHaveBeenCalledTimes(1);
});

it('awaits retirement already underway when stop begins', async () => {
  const closing = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const close = jest.fn(async () => {
    started.resolve();
    await closing.promise;
  });
  const pool = new RemoteLeasePool(async () => ({ value: 1, close, alive: () => true }), {
    maxAgeMs: 1000,
    maxRuns: 1,
  });
  const lease = await pool.acquire('a');
  const retiring = lease.release(true);
  await started.promise;
  const stopped = jest.fn();
  const stopping = pool.stop().then(stopped);
  try {
    await new Promise((resolve) => setImmediate(resolve));
    expect(stopped).not.toHaveBeenCalled();
  } finally {
    closing.resolve();
    await retiring;
    await stopping;
  }
  expect(stopped).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});

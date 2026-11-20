/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { RemoteLeaseParent } from '@kbn/core-remote-server';
import { recordRemoteTiming } from '@kbn/core-remote-common';

export interface LeaseHost<T> {
  readonly value: T;
  readonly close: () => Promise<void>;
  readonly alive: () => boolean;
  readonly terminated?: AbortSignal;
  /** Present only for a separate process, whose RSS can be reclaimed by retirement. */
  readonly rssBytes?: () => Promise<number>;
}

interface ManagedHost<T> {
  readonly host: LeaseHost<T>;
  readonly born: number;
  runs: number;
  settingsKey?: string;
  closing?: Promise<void>;
  onTermination?: () => void;
  parentToken?: object;
}

interface Waiter {
  readonly grant: () => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
  readonly onAbort: () => void;
}

/** One ordinary warm host per graph; leases serialize dispatch and retire incompatible or exhausted hosts. */
export class RemoteLeasePool<T> {
  private host?: ManagedHost<T>;
  private readonly activeLeases = new Map<object, { runId: string; depth: number }>();
  private readonly scheduledParents = new Map<string, RemoteLeaseParent>();
  private readonly nestedPools = new Set<RemoteLeasePool<T>>();
  private creating?: Promise<ManagedHost<T>>;
  private busy = false;
  private stopped = false;
  private stopping?: Promise<void>;
  private readonly retirements = new Set<Promise<void>>();
  private readonly waiters: Waiter[] = [];

  constructor(
    private readonly create: () => Promise<LeaseHost<T>>,
    private readonly policy: { maxAgeMs: number; maxRuns: number; maxRssBytes?: number },
    private readonly now: () => number = Date.now,
    private readonly name: string = 'remote host',
    private readonly maxNestedHosts: number = 10
  ) {
    if (
      !Number.isSafeInteger(maxNestedHosts) ||
      maxNestedHosts < 0 ||
      !Number.isFinite(policy.maxAgeMs) ||
      policy.maxAgeMs <= 0 ||
      !Number.isInteger(policy.maxRuns) ||
      policy.maxRuns <= 0 ||
      (policy.maxRssBytes !== undefined &&
        (!Number.isSafeInteger(policy.maxRssBytes) || policy.maxRssBytes <= 0))
    ) {
      throw new Error('Invalid remote reuse policy');
    }
  }

  async warm(): Promise<void> {
    if (this.stopped) throw new Error('Remote lease pool stopped');
    if (this.host) return;
    this.creating ??= this.create().then(async (host) => {
      const managed: ManagedHost<T> = { host, born: this.now(), runs: 0 };
      if (this.stopped) {
        await this.retire(managed);
        throw new Error('Remote lease pool stopped');
      }
      this.host = managed;
      managed.onTermination = () => {
        // Shutdown and acquisitions observe this same promise; event callbacks cannot await it.
        void this.retire(managed).catch(() => undefined);
      };
      host.terminated?.addEventListener('abort', managed.onTermination, { once: true });
      if (host.terminated?.aborted) managed.onTermination();
      return managed;
    });
    try {
      await this.creating;
    } finally {
      this.creating = undefined;
    }
  }

  async acquire(
    settingsKey: string,
    signal?: AbortSignal,
    identity?: { runId: string; parent?: RemoteLeaseParent }
  ): Promise<{
    value: T;
    parentToken: object;
    release: (discard?: boolean) => Promise<void>;
  }> {
    const scheduledParent = identity && this.scheduledParents.get(identity.runId);
    if (identity) this.scheduledParents.delete(identity.runId);
    const parent = identity?.parent ?? scheduledParent;
    const held = parent?.isActive() ? this.activeLeases.get(parent.token) : undefined;
    if (held && parent && identity)
      return this.acquireNested(settingsKey, signal, identity.runId, parent, held.depth + 1);
    recordRemoteTiming('remote_pool_acquire_requested', {
      graphId: this.name,
      poolBusy: this.busy,
      poolWaiters: this.waiters.length,
    });
    await this.takeSlot(signal);
    recordRemoteTiming('remote_pool_slot_acquired', { graphId: this.name });
    try {
      const current = this.host;
      if (
        current &&
        (!current.host.alive() ||
          this.now() - current.born >= this.policy.maxAgeMs ||
          current.runs >= this.policy.maxRuns ||
          (current.settingsKey !== undefined && current.settingsKey !== settingsKey))
      )
        await this.untilAborted(this.retire(), signal);
      await this.untilAborted(this.warm(), signal);
      signal?.throwIfAborted();
      const managed = this.host;
      if (!managed) throw new Error('Remote host was not initialized');
      managed.settingsKey = settingsKey;
      managed.runs++;
      const parentToken = {};
      managed.parentToken = parentToken;
      this.activeLeases.set(parentToken, { runId: identity?.runId ?? 'unknown', depth: 0 });
      let released = false;
      return {
        value: managed.host.value,
        parentToken,
        release: async (discard = false) => {
          if (released) return;
          released = true;
          this.releaseParent(parentToken);
          try {
            if (discard || !managed.host.alive()) {
              await this.retire(managed);
            } else if (this.policy.maxRssBytes !== undefined && managed.host.rssBytes) {
              let rssBytes: number;
              try {
                rssBytes = await managed.host.rssBytes();
                if (!Number.isSafeInteger(rssBytes) || rssBytes <= 0) {
                  throw new Error(`Remote host "${this.name}" returned invalid RSS`);
                }
              } catch (error) {
                await this.retire(managed);
                throw error;
              }
              if (rssBytes > this.policy.maxRssBytes) await this.retire(managed);
            }
          } finally {
            this.giveSlot();
          }
        },
      };
    } catch (error) {
      this.giveSlot();
      throw error;
    }
  }

  associateScheduledChild(childExecutionId: string, parent: RemoteLeaseParent): void {
    const held = parent.isActive() ? this.activeLeases.get(parent.token) : undefined;
    if (!held || this.stopped) return;
    this.checkNestedAllowance(childExecutionId, parent, held.depth + 1);
    this.scheduledParents.set(childExecutionId, parent);
  }

  private releaseParent(token: object): void {
    this.activeLeases.delete(token);
    for (const [childExecutionId, parent] of this.scheduledParents) {
      if (parent.token === token) this.scheduledParents.delete(childExecutionId);
    }
  }

  private checkNestedAllowance(runId: string, parent: RemoteLeaseParent, depth: number): void {
    if (
      depth > this.maxNestedHosts ||
      this.nestedPools.size + this.scheduledParents.size >= this.maxNestedHosts
    )
      throw new Error(
        `Remote graph "${this.name}" cannot start nested run "${runId}" while parent run "${parent.runId}" holds a lease: nesting allowance (${this.maxNestedHosts}) exhausted`
      );
  }

  private async acquireNested(
    settingsKey: string,
    signal: AbortSignal | undefined,
    runId: string,
    parent: RemoteLeaseParent,
    depth: number
  ): Promise<{ value: T; parentToken: object; release: (discard?: boolean) => Promise<void> }> {
    if (this.stopped) throw new Error('Remote lease pool stopped');
    signal?.throwIfAborted();
    this.checkNestedAllowance(runId, parent, depth);
    // Separate hosts preserve one active run per process, including during synchronous coordinator callbacks.
    const nested = new RemoteLeasePool(this.create, this.policy, this.now, this.name, 0);
    this.nestedPools.add(nested);
    try {
      const acquired = await nested.acquire(settingsKey, signal);
      if (!parent.isActive() || !this.activeLeases.has(parent.token)) {
        await acquired.release();
        await nested.stop();
        this.nestedPools.delete(nested);
        return this.acquire(settingsKey, signal, { runId });
      }
      const parentToken = {};
      this.activeLeases.set(parentToken, { runId, depth });
      let released = false;
      return {
        value: acquired.value,
        parentToken,
        release: async (discard) => {
          if (released) return;
          released = true;
          this.activeLeases.delete(parentToken);
          try {
            await acquired.release(discard);
          } finally {
            try {
              await nested.stop();
            } finally {
              this.nestedPools.delete(nested);
            }
          }
        },
      };
    } catch (error) {
      try {
        await nested.stop();
      } finally {
        this.nestedPools.delete(nested);
      }
      throw error;
    }
  }

  /**
   * Lets an acquisition stop waiting when it is cancelled. The underlying retirement/creation
   * stays owned by the pool and keeps running; only this caller's wait ends.
   */
  private async untilAborted<R>(work: Promise<R>, signal?: AbortSignal): Promise<R> {
    if (!signal) return work;
    work.catch(() => undefined);
    signal.throwIfAborted();
    let onAbort = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason ?? new Error('Remote lease acquisition aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([work, aborted]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.activeLeases.clear();
    this.scheduledParents.clear();
    for (const waiter of this.waiters.splice(0)) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
      waiter.reject(new Error('Remote lease pool stopped'));
    }
    const closing = (async () => {
      await Promise.all([...this.nestedPools].map((pool) => pool.stop()));
      this.nestedPools.clear();
      await this.creating?.catch(() => undefined);
      await this.retire();
      await Promise.all([...this.retirements]);
    })();
    let timeout: ReturnType<typeof setTimeout>;
    this.stopping = Promise.race([
      closing,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Remote host "${this.name}" did not close within 5000ms`)),
          5000
        );
      }),
    ]).finally(() => clearTimeout(timeout));
    return this.stopping;
  }

  private retire(previous = this.host): Promise<void> {
    if (!previous) return Promise.resolve();
    if (previous.closing) return previous.closing;
    if (this.host === previous) this.host = undefined;
    if (previous.parentToken) this.releaseParent(previous.parentToken);
    if (previous.onTermination) {
      previous.host.terminated?.removeEventListener('abort', previous.onTermination);
    }
    // Publish before invoking close: closing the transport may synchronously signal termination.
    const closing = Promise.resolve().then(() => previous.host.close());
    previous.closing = closing;
    this.retirements.add(closing);
    void closing.then(
      () => this.retirements.delete(closing),
      () => this.retirements.delete(closing)
    );
    return closing;
  }

  private async takeSlot(signal?: AbortSignal): Promise<void> {
    if (this.stopped) throw new Error('Remote lease pool stopped');
    signal?.throwIfAborted();
    if (!this.busy) {
      this.busy = true;
      return;
    }
    await new Promise<void>((grant, reject) => {
      const waiter: Waiter = {
        grant,
        reject,
        signal,
        onAbort: () => {
          signal?.removeEventListener('abort', waiter.onAbort);
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error('Remote lease acquisition aborted'));
        },
      };
      this.waiters.push(waiter);
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
      if (signal?.aborted) waiter.onAbort();
    });
  }

  private giveSlot(): void {
    recordRemoteTiming('remote_pool_slot_released', {
      graphId: this.name,
      poolWaiters: this.waiters.length,
    });
    const next = this.waiters.shift();
    if (!next) {
      this.busy = false;
      return;
    }
    next.signal?.removeEventListener('abort', next.onAbort);
    next.grant();
  }
}

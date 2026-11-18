/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

export interface LeaseHost<T> {
  readonly value: T;
  readonly close: () => Promise<void>;
  readonly alive: () => boolean;
  readonly terminated?: AbortSignal;
}

interface ManagedHost<T> {
  readonly host: LeaseHost<T>;
  readonly born: number;
  runs: number;
  settingsKey?: string;
  closing?: Promise<void>;
  onTermination?: () => void;
}

interface Waiter {
  readonly grant: () => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
  readonly onAbort: () => void;
}

/** One warm host per graph; leases serialize dispatch and retire incompatible or exhausted hosts. */
export class RemoteLeasePool<T> {
  private host?: ManagedHost<T>;
  private creating?: Promise<ManagedHost<T>>;
  private busy = false;
  private stopped = false;
  private stopping?: Promise<void>;
  private readonly retirements = new Set<Promise<void>>();
  private readonly waiters: Waiter[] = [];

  constructor(
    private readonly create: () => Promise<LeaseHost<T>>,
    private readonly policy: { maxAgeMs: number; maxRuns: number },
    private readonly now: () => number = Date.now,
    private readonly name: string = 'remote host'
  ) {
    if (
      !Number.isFinite(policy.maxAgeMs) ||
      policy.maxAgeMs <= 0 ||
      !Number.isInteger(policy.maxRuns) ||
      policy.maxRuns <= 0
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
    signal?: AbortSignal
  ): Promise<{
    value: T;
    release: (discard?: boolean) => Promise<void>;
  }> {
    await this.takeSlot(signal);
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
      let released = false;
      return {
        value: managed.host.value,
        release: async (discard = false) => {
          if (released) return;
          released = true;
          try {
            if (discard) await this.retire(managed);
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
    for (const waiter of this.waiters.splice(0)) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
      waiter.reject(new Error('Remote lease pool stopped'));
    }
    const closing = (async () => {
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
    const next = this.waiters.shift();
    if (!next) {
      this.busy = false;
      return;
    }
    next.signal?.removeEventListener('abort', next.onAbort);
    next.grant();
  }
}

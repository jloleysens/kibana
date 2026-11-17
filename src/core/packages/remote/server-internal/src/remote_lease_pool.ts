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
}

interface ManagedHost<T> {
  readonly host: LeaseHost<T>;
  readonly born: number;
  runs: number;
  settingsKey?: string;
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
  private readonly waiters: Waiter[] = [];

  constructor(
    private readonly create: () => Promise<LeaseHost<T>>,
    private readonly policy: { maxAgeMs: number; maxRuns: number },
    private readonly now: () => number = Date.now
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
      if (this.stopped) {
        await host.close();
        throw new Error('Remote lease pool stopped');
      }
      return { host, born: this.now(), runs: 0 };
    });
    try {
      this.host = await this.creating;
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
        await this.retire();
      await this.warm();
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
            if (discard) await this.retire();
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

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
      waiter.reject(new Error('Remote lease pool stopped'));
    }
    await this.creating?.catch(() => undefined);
    await this.retire();
  }

  private async retire(): Promise<void> {
    const previous = this.host;
    this.host = undefined;
    await previous?.host.close();
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

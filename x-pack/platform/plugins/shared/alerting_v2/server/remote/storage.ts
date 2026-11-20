/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'node:crypto';
import type { KibanaRequest } from '@kbn/core/server';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { remotable, recordRemoteTiming } from '@kbn/core-remote-common';
import {
  createAlertEventDataSchema,
  type CreateAlertEventData,
} from '@kbn/alerting-v2-schemas/src/create_alert_event_data_schema';
import { getGroupHash } from '../lib/alert_events_client/alert_event_algorithms';
import type { AlertEventStorage } from '../lib/alert_events_client/alert_event_storage';
import type { AlertEventStorageApi } from './tokens';

interface StorageDependencies {
  canWrite(request: KibanaRequest): Promise<boolean>;
  getStorage(request: KibanaRequest): AlertEventStorage;
}
/** Holds internal query/write authority behind run-owned alert-series references. */
@remotable()
export class ScopedAlertEventStorage implements AlertEventStorageApi {
  readonly #references = new Map<
    string,
    {
      scopeId: string;
      storage: AlertEventStorage;
      groupHash?: string;
      persisted: boolean;
      controller: AbortController;
      release(): void;
    }
  >();
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly dependencies: StorageDependencies
  ) {}
  async parse(scopeId: string, input: unknown): Promise<CreateAlertEventData> {
    return this.#call(scopeId, 'parse', async () => createAlertEventDataSchema.parse(input));
  }
  async canWrite(scopeId: string): Promise<boolean> {
    return this.#call(scopeId, 'canWrite', () =>
      this.dependencies.canWrite(this.scopes.get<KibanaRequest>(scopeId))
    );
  }
  async open(scopeId: string): ReturnType<AlertEventStorageApi['open']> {
    return this.#call(scopeId, 'open', async () => {
      const request = this.scopes.get<KibanaRequest>(scopeId);
      if (!(await this.dependencies.canWrite(request)))
        throw new Error('Insufficient privileges to create alert events');
      const storage = this.dependencies.getStorage(request);
      const { spaceId } = this.scopes.getRunState(scopeId);
      if (storage.spaceId !== spaceId)
        throw new Error('Alert storage scope does not match workflow space');
      const reference = randomUUID();
      const signal = this.scopes.getAbortSignal(scopeId);
      const controller = new AbortController();
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        controller.abort(signal.reason);
        this.#references.delete(reference);
        signal.removeEventListener('abort', release);
      };
      // Publish before subscribing. An abort that lands in that gap must delete the
      // series; a listener that runs before insertion would otherwise no-op forever.
      signal.throwIfAborted();
      this.#references.set(reference, {
        scopeId,
        storage,
        controller,
        persisted: false,
        release,
      });
      signal.addEventListener('abort', release, { once: true });
      if (signal.aborted) {
        release();
        throw new Error('Alert storage scope aborted');
      }
      return { reference, spaceId };
    });
  }
  async readLatest(
    scopeId: string,
    reference: string,
    event: Parameters<AlertEventStorageApi['readLatest']>[2]
  ): ReturnType<AlertEventStorageApi['readLatest']> {
    return this.#call(scopeId, 'readLatest', async () => {
      const state = this.#reference(scopeId, reference);
      if (state.groupHash !== undefined) throw new Error('Alert series reference already read');
      const groupHash = getGroupHash(
        createAlertEventDataSchema.parse(event),
        state.storage.spaceId
      );
      state.groupHash = groupHash;
      return state.storage.readLatest(groupHash, state.controller.signal);
    });
  }
  async persist(
    scopeId: string,
    reference: string,
    doc: Parameters<AlertEventStorageApi['persist']>[2]
  ): Promise<void> {
    return this.#call(scopeId, 'persist', async () => {
      const state = this.#reference(scopeId, reference);
      if (state.groupHash === undefined)
        throw new Error('Alert series reference has not been read');
      if (state.persisted) throw new Error('Alert series reference already persisted');
      state.persisted = true;
      await state.storage.persist({
        ...(doc['@timestamp'] != null ? { '@timestamp': doc['@timestamp'] } : {}),
        scheduled_timestamp: doc.scheduled_timestamp,
        group_hash: state.groupHash,
        data: doc.data,
        status: doc.status,
        source: doc.source,
        type: doc.type,
        alert: doc.alert,
        space_id: state.storage.spaceId,
        ...(doc.severity != null ? { severity: doc.severity } : {}),
      });
    });
  }
  async close(scopeId: string, reference: string): Promise<void> {
    // Scope disposal deletes the lookup and then aborts. Cleanup must not need that lookup.
    const state = this.#references.get(reference);
    if (!state) return;
    if (state.scopeId !== scopeId) throw new Error('Unknown alert series reference');
    state.release();
  }
  #reference(scopeId: string, reference: string) {
    const state = this.#references.get(reference);
    if (!state || state.scopeId !== scopeId) throw new Error('Unknown alert series reference');
    return state;
  }
  async #call<T>(scopeId: string, operation: string, execute: () => Promise<T>): Promise<T> {
    try {
      this.scopes.get<KibanaRequest>(scopeId);
      this.scopes.getAbortSignal(scopeId).throwIfAborted();
      recordRemoteTiming('alerting_storage_operation', { scopeId, operation });
      return await execute();
    } catch (error) {
      const source = error instanceof Error ? error : new Error(String(error));
      const safe =
        source instanceof TypeError
          ? new TypeError(source.message)
          : source instanceof RangeError
          ? new RangeError(source.message)
          : new Error(source.message);
      throw Object.assign(safe, { alertEventErrorName: source.name });
    }
  }
}

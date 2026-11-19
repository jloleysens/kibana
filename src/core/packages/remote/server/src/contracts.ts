/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ServiceToken } from '@kbn/core-di';

/** Backend selected by Core configuration. Callers register a graph, not a placement. */
export type RemoteBackend = 'worker_thread' | 'in_process' | 'child_process';

export interface RemoteRunState {
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly spaceId: string;
  readonly admittedChildren: ReadonlySet<string>;
}

export interface ScopeLookup {
  /** Coordinator-only metadata installed by the dispatcher, never by the executor. */
  getRunState(scopeId: string): RemoteRunState;
  /** Coordinator-only admission after a successful child start. */
  admitChild(scopeId: string, childId: string): void;
  get<T>(scopeId: string): T;
  /** Scope lifetime is a cancellation signal, including transport failure. */
  getAbortSignal(scopeId: string): AbortSignal;
}

export interface RemoteRegistration {
  readonly id: string;
  readonly reuse?: {
    readonly maxAgeMs: number;
    readonly maxRuns: number;
    /** Retire a child process after release above this RSS; shared-process backends do not sample. */
    readonly maxRssBytes?: number;
  };
  readonly root: ServiceToken<unknown>;
  readonly contributions: readonly ServiceToken<unknown>[];
  /** Executor providers this graph injects, such as its step catalogue. */
  readonly dependencies?: readonly ServiceToken<unknown>[];
}

export interface RemoteSession<T> {
  readonly stub: T;
  openScope(state: unknown, runState?: RemoteRunState): string;
  closeScope(scopeId: string): void;
  getScope<TState>(scopeId: string): TState;
}

export interface RemoteLease<T> extends RemoteSession<T> {
  /** Release after all scopes are closed; discard a damaged host instead of reusing it. */
  release(discard?: boolean): Promise<void>;
}

/**
 * Public setup contract. `register` declares a graph. `bind` supplies a coordinator-side
 * implementation. `whenReady` resolves after Core has started that graph; plugin `start`
 * must not await it.
 *
 * @public
 */
export interface RemoteSetup {
  register(registration: RemoteRegistration): void;
  bind(token: ServiceToken<unknown>, factory: (scopes: ScopeLookup) => object): void;
  /** Uses Core-owned clients instead of direct worker clients for an executor capability. */
  bindInProcess(token: ServiceToken<unknown>, factory: (scopes: ScopeLookup) => object): void;
  whenReady<T>(id: string): Promise<RemoteSession<T>>;
  /** Acquires exclusive use of a warm graph; changed settings retire the previous host. */
  lease<T>(
    id: string,
    options?: { settingsKey?: string; signal?: AbortSignal }
  ): Promise<RemoteLease<T>>;
}

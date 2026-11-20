/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ScopeLookup } from './contracts';

export interface RemoteLeaseParent {
  readonly token: object;
  readonly runId: string;
  readonly signal: AbortSignal;
  /** Callback ancestry only. Reservations stay live while the lease token is held. */
  readonly isActive: () => boolean;
  readonly associateChild?: (childExecutionId: string) => void;
  readonly reserveChild?: () => string;
  readonly bindChild?: (slot: string, childExecutionId: string) => void;
  readonly releaseChild?: (slot: string) => void;
}
interface ScopedLeaseParent {
  readonly token: object;
  readonly signal: AbortSignal;
  readonly associateChild?: (childExecutionId: string, parent: RemoteLeaseParent) => void;
  readonly reserveChild?: (parent: RemoteLeaseParent) => string;
  readonly bindChild?: (slot: string, childExecutionId: string) => void;
  readonly releaseChild?: (slot: string) => void;
}
const parents = new WeakMap<ScopeLookup, (scopeId: string) => ScopedLeaseParent | undefined>();
const context = new AsyncLocalStorage<RemoteLeaseParent>();
/** Parent binding captured for work that schedules children after the callback returns. */
const capturedParents = new AsyncLocalStorage<RemoteLeaseParent>();

const leaseParent = (
  parent: ScopedLeaseParent,
  workflowRunId: string,
  isActive: () => boolean
): RemoteLeaseParent => {
  const lease: RemoteLeaseParent = {
    token: parent.token,
    runId: workflowRunId,
    signal: parent.signal,
    isActive,
    associateChild: (childExecutionId) => parent.associateChild?.(childExecutionId, lease),
    reserveChild: () => parent.reserveChild?.(lease) ?? '',
    bindChild: (slot, childExecutionId) => parent.bindChild?.(slot, childExecutionId),
    releaseChild: (slot) => parent.releaseChild?.(slot),
  };
  return lease;
};

/** Core binds opaque pool-owned lease tokens to coordinator-only scope lookups. */
export const registerRemoteLeaseParents = (
  scopes: ScopeLookup,
  resolve: (scopeId: string) => ScopedLeaseParent | undefined
): void => {
  parents.set(scopes, resolve);
};

/** Marks synchronous coordinator work as belonging to its verified active lease, never to a worker claim. */
export const withRemoteLeaseParent = async <T>(
  scopes: ScopeLookup,
  scopeId: string,
  work: () => Promise<T>
): Promise<T> => {
  const parent = parents.get(scopes)?.(scopeId);
  if (!parent) return work();
  parent.signal.throwIfAborted();
  const { workflowRunId } = scopes.getRunState(scopeId);
  let active = true;
  const lease = leaseParent(parent, workflowRunId, () => active && !parent.signal.aborted);
  return context.run(lease, async () => {
    try {
      return await work();
    } finally {
      active = false;
    }
  });
};

/**
 * Snapshots the coordinator lease binding for background scheduling.
 * Does not mint a credential and does not keep callback ancestry alive.
 */
export const captureRemoteLeaseParent = (
  scopes: ScopeLookup,
  scopeId: string
): RemoteLeaseParent | undefined => {
  const parent = parents.get(scopes)?.(scopeId);
  if (!parent) return undefined;
  const { workflowRunId } = scopes.getRunState(scopeId);
  return leaseParent(parent, workflowRunId, () => !parent.signal.aborted);
};

/** Runs background scheduling against a binding captured while the parent lease existed. */
export const runWithCapturedLeaseParent = async <T>(
  binding: RemoteLeaseParent,
  work: () => Promise<T>
): Promise<T> => capturedParents.run(binding, work);

/** Reads capacity-only ancestry inside the coordinator; tokens are never transported. */
export const getRemoteLeaseParent = (): RemoteLeaseParent | undefined => {
  const parent = context.getStore();
  return parent?.isActive() ? parent : undefined;
};

const schedulingParent = (): RemoteLeaseParent | undefined =>
  getRemoteLeaseParent() ?? capturedParents.getStore();

/** Associates only a coordinator-created scheduled execution with its active capacity parent. */
export const associateRemoteLeaseChild = (childExecutionId: string): void => {
  schedulingParent()?.associateChild?.(childExecutionId);
};

/** Occupies one nesting slot before an execution id exists. Empty when no parent lease is held. */
export const reserveRemoteLeaseChild = (): string | undefined => {
  const slot = schedulingParent()?.reserveChild?.();
  return slot ? slot : undefined;
};

/** Binds a reserved slot to the coordinator-authored execution id. Does not throw. */
export const bindRemoteLeaseChild = (slot: string, childExecutionId: string): void => {
  schedulingParent()?.bindChild?.(slot, childExecutionId);
};

/** Drops a reserved slot when scheduling fails before an execution exists. */
export const releaseRemoteLeaseReservation = (slot: string): void => {
  schedulingParent()?.releaseChild?.(slot);
};

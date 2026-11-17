/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

export enum ExecutionStatus {
  // In progress
  PENDING = 'pending',
  WAITING = 'waiting',
  WAITING_FOR_INPUT = 'waiting_for_input',
  WAITING_FOR_CHILD = 'waiting_for_child',
  RUNNING = 'running',
  /** Persisted concurrency backlog - does not count toward concurrency max until promoted to pending + scheduled */
  QUEUED = 'queued',

  // Done
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  TIMED_OUT = 'timed_out',
  SKIPPED = 'skipped',
}
export type ExecutionStatusUnion = `${ExecutionStatus}`;
export const ExecutionStatusValues = Object.values(ExecutionStatus);

export const TerminalExecutionStatuses: readonly ExecutionStatus[] = [
  ExecutionStatus.COMPLETED,
  ExecutionStatus.FAILED,
  ExecutionStatus.CANCELLED,
  ExecutionStatus.SKIPPED,
  ExecutionStatus.TIMED_OUT,
] as const;

export const NonTerminalExecutionStatuses: readonly ExecutionStatus[] = [
  ExecutionStatus.PENDING,
  ExecutionStatus.WAITING,
  ExecutionStatus.WAITING_FOR_INPUT,
  ExecutionStatus.WAITING_FOR_CHILD,
  ExecutionStatus.RUNNING,
  ExecutionStatus.QUEUED,
] as const;

/** Workflow executions occupying a concurrency slot (excludes queued backlog). */
export const ConcurrencySlotOccupyingExecutionStatuses: readonly ExecutionStatus[] = [
  ExecutionStatus.PENDING,
  ExecutionStatus.WAITING,
  ExecutionStatus.WAITING_FOR_INPUT,
  ExecutionStatus.WAITING_FOR_CHILD,
  ExecutionStatus.RUNNING,
] as const;

/** True when an execution cannot be resumed or run again. */
export const isTerminalStatus = (status: ExecutionStatus): boolean =>
  TerminalExecutionStatuses.includes(status);

/** Default iteration guard for workflow loops. */
export const DEFAULT_LOOP_MAX_ITERATIONS = 2000;

export { parseJsPropertyAccess } from './parse_js_property_access';

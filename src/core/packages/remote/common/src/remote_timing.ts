/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { appendFileSync } from 'node:fs';
import { isMainThread, threadId } from 'node:worker_threads';

export interface RemoteTimingContext {
  readonly executionId?: string;
  readonly taskId?: string;
  readonly scopeId?: string;
  readonly graphId?: string;
  readonly stepId?: string;
  readonly stepType?: string;
  readonly durationMs?: number;
  readonly cached?: boolean;
  readonly dispatch?: 'direct' | 'task_manager';
  readonly atEpochMs?: number;
}

/** Records opt-in scalar lifecycle measurements, never invocation payloads or credentials. */
export const recordRemoteTiming = (event: string, context: RemoteTimingContext): void => {
  const at = context.atEpochMs ?? performance.timeOrigin + performance.now();
  const path = process.env.KBN_REMOTE_TIMING_LOG;
  if (!path) return;
  appendFileSync(
    path,
    JSON.stringify({
      event,
      at,
      pid: process.pid,
      threadId,
      isMainThread,
      executionId: context.executionId,
      taskId: context.taskId,
      scopeId: context.scopeId,
      graphId: context.graphId,
      stepId: context.stepId,
      stepType: context.stepType,
      durationMs: context.durationMs,
      cached: context.cached,
      dispatch: context.dispatch,
    }) + '\n'
  );
};

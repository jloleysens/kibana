/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { KibanaRequest, Logger } from '@kbn/core/server';
import { recordRemoteHeap, recordRemoteTiming, recordSeam } from '@kbn/core-remote-common';
import type { RemoteSetup } from '@kbn/core-remote-server';
import type { WorkflowDispatchFacts, WorkflowExecutorApi, WorkflowRunOutcome } from './tokens';
import { workflowDispatchCredentials } from './workflow_dispatch_credentials';
import type { StepDependencyPlan } from '../workflow_context_manager/step_dependency_plan';
import { isWorkflowTaskManagerAbortSignal } from '../workflow_task_shutdown';

/** Dispatches under an exclusive warm-host lease using the identity approved by shared guards. */
export const dispatchWorkflow = async ({
  remote,
  request,
  signal,
  workflowRunId,
  spaceId,
  facts,
  dependencyPlan,
  logger,
  phase,
}: {
  remote: RemoteSetup;
  request: KibanaRequest;
  signal: AbortSignal;
  workflowRunId: string;
  spaceId: string;
  facts: WorkflowDispatchFacts;
  dependencyPlan: StepDependencyPlan;
  logger: Logger;
  phase: 'run' | 'resume';
}): Promise<WorkflowRunOutcome> => {
  signal.throwIfAborted();
  recordRemoteTiming('lease_requested', { executionId: workflowRunId });
  const lease = await remote.lease<WorkflowExecutorApi>('workflows', {
    settingsKey: JSON.stringify(facts),
    signal,
  });
  recordRemoteTiming('lease_acquired', { executionId: workflowRunId });
  let scopeId: string | undefined;
  try {
    scopeId = lease.openScope(request);
    const activeScope = scopeId;
    const onAbort = () => {
      void lease.stub
        .cancel(activeScope, isWorkflowTaskManagerAbortSignal(signal) ? 'task_manager' : undefined)
        .catch(() => logger.warn('Remote workflow cancellation failed'));
    };
    recordRemoteTiming('dispatched', { executionId: workflowRunId, scopeId });
    const runRequest = {
      scopeId,
      workflowRunId,
      spaceId,
      credentials: workflowDispatchCredentials(request),
      facts,
      dependencyPlan,
    };
    recordSeam('WorkflowDependencyPlan', dependencyPlan);
    recordSeam('WorkflowExecutor.run.request', runRequest);
    const pending = lease.stub.run(runRequest);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    try {
      return await pending;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  } finally {
    if (scopeId) lease.closeScope(scopeId);
    await lease.release();
    recordRemoteHeap('MAIN_HEAP', `after-remote-${phase}`);
  }
};

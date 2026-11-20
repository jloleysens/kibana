/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { randomUUID } from 'node:crypto';
import { ExecutionError, ExecutionStatus } from '@kbn/workflows-runtime';
import type { WorkflowStepDescription, WorkflowStepRunnerApi } from './tokens';
import type { CancellableNode, NodeImplementation } from '../step/node_implementation';
import type { StepExecutionRuntime } from '../workflow_context_manager/step_execution_runtime';
import type { StepIoService } from '../workflow_context_manager/step_io_service';
import type { WorkflowExecutionRuntimeManager } from '../workflow_context_manager/workflow_execution_runtime_manager';

/** Runs service-heavy core nodes by reference; the existing node implementation owns semantics. */
export const createRemoteNode = ({
  description,
  runner,
  runtime,
  workflowRuntime,
  stepIoService,
  scopeId,
}: {
  description: WorkflowStepDescription;
  runner: WorkflowStepRunnerApi;
  runtime: StepExecutionRuntime;
  workflowRuntime: WorkflowExecutionRuntimeManager;
  stepIoService: StepIoService;
  scopeId: string;
}): NodeImplementation & CancellableNode => {
  const invoke = async (phase: 'node' | 'nodeCancel') => {
    await stepIoService.flush();
    if (phase !== 'nodeCancel') runtime.abortController.signal.throwIfAborted();
    const invocationId = randomUUID();
    const pending = runner.invoke({
      invocationId,
      scopeId,
      phase,
      executionId: runtime.workflowExecution.id,
      spaceId: runtime.workflowExecution.spaceId,
      nodeId: runtime.node.id,
      stackFrames: runtime.scopeStack.stackFrames,
      description,
      now: runtime.contextManager.getContext().now ?? new Date(),
      aborted: runtime.abortController.signal.aborted,
    });
    const onAbort = () => {
      void runner
        .cancel(invocationId)
        .catch(() => runtime.stepLogger.logWarn('Remote node cancellation failed'));
    };
    runtime.abortController.signal.addEventListener('abort', onAbort, { once: true });
    try {
      await pending;
    } finally {
      runtime.abortController.signal.removeEventListener('abort', onAbort);
    }
  };
  let activeRun: Promise<void> | undefined;
  const run = async () => {
    if (!runtime.stepExecution) runtime.startStep();
    await invoke('node');
    if (runtime.abortController.signal.aborted) return;
    await stepIoService.loadStep(runtime.stepExecutionId);
    if (runtime.stepExecution?.status === ExecutionStatus.COMPLETED)
      runtime.recordTokenUsage(runtime.getCurrentStepResult()?.output);
    if (runtime.stepExecution?.error)
      runtime.failStep(new ExecutionError(runtime.stepExecution.error));
    if (
      runtime.stepExecution?.status === ExecutionStatus.COMPLETED ||
      runtime.stepExecution?.status === ExecutionStatus.FAILED
    )
      workflowRuntime.navigateToNextNode();
  };
  return {
    run: () => {
      activeRun = run();
      return activeRun;
    },
    onCancel: async () => {
      // A just-created child id must reach storage before cancellation reconstructs its node.
      // The run caller retains its rejection; cleanup still runs after a failed phase.
      if (activeRun) await Promise.allSettled([activeRun]);
      await invoke('nodeCancel');
    },
  };
};

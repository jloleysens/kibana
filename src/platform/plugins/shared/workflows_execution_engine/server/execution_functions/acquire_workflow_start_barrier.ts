/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { recordRemoteTiming } from '@kbn/core-remote-common';
import type { EsWorkflowExecution } from '@kbn/workflows';
import { ExecutionStatus } from '@kbn/workflows-runtime';
import type { StepExecutionRepository } from '../repositories/step_execution_repository';
import type { WorkflowExecutionRepository } from '../repositories/workflow_execution_repository';

export const hasNoWorkflowStartEvidence = (execution: EsWorkflowExecution): boolean =>
  execution.status === ExecutionStatus.PENDING &&
  !execution.startedAt &&
  !execution.currentNodeId &&
  !execution.stepExecutionIds?.length;

/** Atomically records the start barrier before any engine loop may cause step side effects. */
export const acquireWorkflowStartBarrier = async ({
  workflowRunId,
  spaceId,
  workflowExecutionRepository,
  stepExecutionRepository,
}: {
  workflowRunId: string;
  spaceId: string;
  workflowExecutionRepository: WorkflowExecutionRepository;
  stepExecutionRepository: StepExecutionRepository;
}): Promise<{ acquired: false } | { acquired: true; startedAt: string }> => {
  const start = performance.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await workflowExecutionRepository.getWorkflowExecutionWithVersion(
      workflowRunId,
      spaceId
    );
    if (!snapshot) throw new Error('Workflow execution not found while acquiring start barrier');
    if (!hasNoWorkflowStartEvidence(snapshot.execution)) return { acquired: false };
    if (await stepExecutionRepository.hasStepExecutionsForWorkflow(workflowRunId)) {
      return { acquired: false };
    }
    const startedAt = new Date().toISOString();
    const writeStarted = performance.now();
    const acquired = await workflowExecutionRepository.tryUpdateWorkflowExecutionWithVersion(
      { id: workflowRunId, startedAt },
      { seqNo: snapshot.seqNo, primaryTerm: snapshot.primaryTerm },
      { refresh: false }
    );
    if (acquired) {
      const writeMs = performance.now() - writeStarted;
      const totalMs = performance.now() - start;
      recordRemoteTiming('engine_start_barrier_write', {
        executionId: workflowRunId,
        durationMs: writeMs,
      });
      recordRemoteTiming('engine_start_barrier', {
        executionId: workflowRunId,
        durationMs: totalMs,
      });
      // Trusted, bounded PoC crash window after the durable barrier and before engine dispatch.
      const faultDelay = Number(process.env.KBN_RUNNER_ENGINE_START_BARRIER_DELAY_MS ?? 0);
      if (Number.isFinite(faultDelay) && faultDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(faultDelay, 30_000)));
      }
      return { acquired: true, startedAt };
    }
  }
  throw new Error('Workflow start barrier contention; retry the task');
};

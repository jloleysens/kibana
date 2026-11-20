/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { KibanaRequest, Logger } from '@kbn/core/server';
import type { ExecutionStatus } from '@kbn/workflows-runtime';
import { handlePostExecutionLoop } from './handle_post_execution_loop';
import { emitWorkflowExecutionFailedEventIfFailed } from '../lib/emit_workflow_execution_failed_event';
import type { WorkflowRunOutcome } from '../remote/tokens';
import type { WorkflowExecutionRepository } from '../repositories/workflow_execution_repository';
import type { WorkflowsExecutionEnginePluginStart } from '../types';
import type { StepDependencyPlan } from '../workflow_context_manager/step_dependency_plan';

export type RemoteWorkflowExecution = (
  request: KibanaRequest,
  signal: AbortSignal,
  dependencyPlan: StepDependencyPlan
) => Promise<WorkflowRunOutcome>;

/** Runs the remote loop only after shared identity and admission checks have succeeded. */
export const executeWorkflowRemotely = async ({
  executeRemote,
  dependencyPlan,
  fakeRequest,
  signal,
  workflowsExecutionEngine,
  ...postExecution
}: Parameters<typeof handlePostExecutionLoop>[0] & {
  executeRemote: RemoteWorkflowExecution;
  dependencyPlan: StepDependencyPlan;
  fakeRequest: KibanaRequest;
  signal: AbortSignal;
  workflowsExecutionEngine: WorkflowsExecutionEnginePluginStart;
  workflowExecutionRepository: WorkflowExecutionRepository;
  logger: Logger;
}): Promise<void> => {
  let outcome: WorkflowRunOutcome | undefined;
  const finishExecution = async (): Promise<void> => {
    try {
      const execution = await postExecution.workflowExecutionRepository.getWorkflowExecutionById(
        postExecution.workflowRunId,
        postExecution.spaceId
      );
      if (execution) {
        await emitWorkflowExecutionFailedEventIfFailed({
          workflowRuntime: {
            getWorkflowExecution: () => execution,
            getWorkflowExecutionStatus: () => execution.status as ExecutionStatus,
          },
          workflowExecutionState: { getLastFailedStepContext: () => outcome?.failedStepContext },
          emitEvent: workflowsExecutionEngine.triggerEvents.emitEvent,
          request: fakeRequest,
          logger: postExecution.logger,
          workflowRunId: postExecution.workflowRunId,
        });
      }
    } finally {
      await handlePostExecutionLoop(postExecution);
    }
  };
  try {
    outcome = await executeRemote(fakeRequest, signal, dependencyPlan);
  } catch (error) {
    // Cleanup must not replace the worker's original execution error.
    await finishExecution().catch((cleanupError) => {
      postExecution.logger.warn(
        `Post-execution handling failed for remote workflow ${postExecution.workflowRunId}: ${
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        }`
      );
    });
    throw error;
  }
  await finishExecution();
};

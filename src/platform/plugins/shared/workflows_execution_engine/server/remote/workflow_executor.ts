/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { inject } from 'inversify';
import { isMainThread, threadId } from 'node:worker_threads';
import { recordRemoteHeap, recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import { ExecutionStatus, isTerminalStatus } from '@kbn/workflows-runtime';
import {
  type WorkflowDataPlaneApi,
  WorkflowDataPlaneToken,
  type WorkflowExecutorApi,
  type WorkflowLogApi,
  WorkflowLogToken,
  type WorkflowRunOutcome,
  type WorkflowRunRequest,
  type WorkflowStepCatalogApi,
  WorkflowStepCatalogToken,
  type WorkflowStepDescription,
  type WorkflowStepRunnerApi,
  WorkflowStepRunnerToken,
  type WorkflowStorageApi,
  WorkflowStorageToken,
} from './tokens';
import { WorkflowTaskManagerAbortError } from '../workflow_task_shutdown';

interface ExecutableStep {
  name?: string;
  type?: string;
  steps?: unknown;
  branches?: unknown;
  else?: ExecutableStep[];
  cases?: Array<{ steps?: ExecutableStep[] }>;
  default?: ExecutableStep[];
  'on-failure'?: { fallback?: ExecutableStep[] };
}

/**
 * Steps that finish inside the current task. `if` and `foreach` are in this set.
 * A `wait` of at least five seconds parks and comes back through the resume task.
 */
const CORE_STEP_TYPES = new Set(['wait', 'if', 'foreach', 'while', 'switch', 'data.set']);

/**
 * Pauses this proof does not run. They use the same resume entry as a long wait.
 * Parallel also stores branch progress. Human input also sends a message through
 * `executeConnector` and reads `resumeInput`.
 */
const UNSUPPORTED_CORE_STEP_TYPES = new Set([
  'parallel',
  'waitForInput',
  'waitForApproval',
  'workflow.execute',
  'workflow.executeAsync',
]);

/**
 * Executes the same engine in either backend with dispatch-bound data clients and lazy nodes.
 * Plugin-owned phases use the coordinator capability; their implementation graph stays out of the worker.
 */
@remotable()
export class WorkflowExecutor implements WorkflowExecutorApi {
  private readonly active = new Map<string, AbortController>();
  constructor(
    @inject(WorkflowStepCatalogToken)
    private readonly steps: WorkflowStepCatalogApi,
    @inject(WorkflowStorageToken)
    private readonly storage: WorkflowStorageApi,
    @inject(WorkflowLogToken)
    private readonly log: WorkflowLogApi,
    @inject(WorkflowDataPlaneToken) private readonly data?: WorkflowDataPlaneApi,
    @inject(WorkflowStepRunnerToken) private readonly stepRunner?: WorkflowStepRunnerApi
  ) {}

  async placement(): Promise<{
    executor: { threadId: number; isMainThread: boolean };
    storage: { threadId: number; isMainThread: boolean };
  }> {
    return {
      executor: { threadId, isMainThread },
      storage: await this.storage.whereAmI(),
    };
  }

  async block(milliseconds: number): Promise<number> {
    const start = Date.now();
    while (Date.now() - start < milliseconds) {
      // Occupies this thread only. The coordinator keeps running.
    }
    return Date.now() - start;
  }

  async cancel(scopeId: string, reason?: 'task_manager'): Promise<void> {
    this.active
      .get(scopeId)
      ?.abort(reason === 'task_manager' ? new WorkflowTaskManagerAbortError() : undefined);
  }

  async run(request: WorkflowRunRequest): Promise<WorkflowRunOutcome> {
    recordRemoteTiming('received', {
      executionId: request.workflowRunId,
      scopeId: request.scopeId,
    });
    if (this.active.has(request.scopeId)) throw new Error('Remote scope is already executing');
    const controller = new AbortController();
    this.active.set(request.scopeId, controller);
    try {
      await this.data?.open(request.scopeId, request.credentials);
      return await this.execute(request, controller.signal);
    } finally {
      this.active.delete(request.scopeId);
      await this.data?.close(request.scopeId);
    }
  }

  private async execute(
    request: WorkflowRunRequest,
    signal: AbortSignal
  ): Promise<WorkflowRunOutcome> {
    signal.throwIfAborted();
    const execution = await this.storage.getExecution(
      request.scopeId,
      request.workflowRunId,
      request.spaceId
    );
    if (isTerminalStatus(execution.status)) {
      return { status: execution.status };
    }

    try {
      if (execution.status === ExecutionStatus.PENDING && !execution.startedAt) {
        throw new Error('Remote workflow execution requires a durable start barrier');
      }
      const descriptions = await this.assertRunnable(execution.workflowDefinition);
      const resume =
        execution.status === ExecutionStatus.WAITING ||
        execution.status === ExecutionStatus.WAITING_FOR_INPUT ||
        (execution.status === ExecutionStatus.RUNNING && Boolean(execution.currentNodeId));
      const importStarted = performance.now();
      const { runWorkflowEngineInWorker } = await import('./assemble_engine_loop');
      recordRemoteTiming('engine_import', {
        executionId: execution.id,
        durationMs: performance.now() - importStarted,
      });
      const outcome = await runWorkflowEngineInWorker({
        execution,
        signal,
        scopeId: request.scopeId,
        steps: this.steps,
        storage: this.storage,
        log: this.log,
        resume,
        esClient: this.data?.user(request.scopeId),
        facts: request.facts,
        remoteSteps: this.stepRunner ? { runner: this.stepRunner, descriptions } : undefined,
      });
      recordRemoteHeap('REMOTE_WORKER_HEAP', outcome.status);
      return outcome;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.storage.complete(request.scopeId, {
        id: execution.id,
        status: ExecutionStatus.FAILED,
        error: { type: 'RemoteExecutionError', message },
        startedAt: execution.startedAt,
      });
      recordRemoteHeap('REMOTE_WORKER_HEAP', 'failed');
      throw error;
    }
  }

  private async assertRunnable(
    definition:
      | {
          steps?: ExecutableStep[];
          settings?: { 'on-failure'?: { fallback?: ExecutableStep[] } };
        }
      | undefined
  ): Promise<WorkflowStepDescription[]> {
    const references = [
      ...walkSteps(definition?.steps),
      ...walkSteps(definition?.settings?.['on-failure']?.fallback),
    ];
    for (const step of references) {
      const stepName = step.name ?? step.type ?? 'step';
      if (!step.type) {
        throw new Error(`Remote step "${stepName}" is missing a type`);
      }
      if (UNSUPPORTED_CORE_STEP_TYPES.has(step.type)) {
        throw new Error(
          `Unsupported remote step type "${step.type}". Parallel, human input, and child workflows are not run in this remote proof.`
        );
      }
      if (
        !this.stepRunner &&
        !CORE_STEP_TYPES.has(step.type) &&
        !step.type.startsWith('elasticsearch.') &&
        !this.steps.supports(step.type)
      ) {
        throw new Error(
          `Unsupported remote step type "${step.type}". Experimental remote execution only runs steps registered for this anchor.`
        );
      }
    }
    const describedTypes = references
      .map(({ type }) => type ?? '')
      .filter((type) => !CORE_STEP_TYPES.has(type));
    return this.stepRunner && describedTypes.length ? this.stepRunner.describe(describedTypes) : [];
  }
}

function walkSteps(steps: unknown): ExecutableStep[] {
  if (!Array.isArray(steps)) {
    return [];
  }
  const found: ExecutableStep[] = [];
  for (const step of steps) {
    if (step && typeof step === 'object') {
      const record = step as ExecutableStep;
      found.push(record);
      found.push(...walkSteps(record.steps));
      found.push(...walkSteps(record.else));
      found.push(...walkSteps(record.default));
      found.push(...walkSteps(record['on-failure']?.fallback));
      for (const branch of record.cases ?? []) found.push(...walkSteps(branch.steps));
      if (Array.isArray(record.branches)) {
        for (const branch of record.branches) {
          if (branch && typeof branch === 'object') {
            found.push(...walkSteps((branch as { steps?: unknown }).steps));
          }
        }
      }
    }
  }
  return found;
}

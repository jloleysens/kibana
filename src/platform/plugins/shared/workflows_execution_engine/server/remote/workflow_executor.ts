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
import type { SpecRuntimeApi } from '@kbn/connector-specs';
import { recordRemoteHeap, recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import { ExecutionStatus, isTerminalStatus } from '@kbn/workflows-runtime';
import {
  SpecRuntimeToken,
  type WorkflowChildApi,
  WorkflowChildToken,
  type WorkflowCredentialsApi,
  WorkflowCredentialsToken,
  type WorkflowDataPlaneApi,
  WorkflowDataPlaneToken,
  type WorkflowExecutorApi,
  type WorkflowHttpApi,
  WorkflowHttpToken,
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
import { workflowDefinitionHash } from '../workflow_context_manager/step_dependency_plan';
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

const CORE_STEP_TYPES = new Set([
  'wait',
  'if',
  'foreach',
  'while',
  'switch',
  'data.set',
  'parallel',
  'waitForInput',
  'waitForApproval',
  'workflow.output',
  'workflow.fail',
  'loop.break',
  'loop.continue',
]);

/**
 * Executes the same engine in either backend with dispatch-bound data clients and lazy nodes.
 * Plugin-owned phases use the coordinator capability; their implementation graph stays out of the worker.
 */
@remotable()
export class WorkflowExecutor implements WorkflowExecutorApi {
  private stopped = false;
  private readonly active = new Map<string, AbortController>();
  constructor(
    @inject(WorkflowStepCatalogToken)
    private readonly steps: WorkflowStepCatalogApi,
    @inject(WorkflowStorageToken)
    private readonly storage: WorkflowStorageApi,
    @inject(WorkflowLogToken)
    private readonly log: WorkflowLogApi,
    @inject(WorkflowDataPlaneToken) private readonly data?: WorkflowDataPlaneApi,
    @inject(WorkflowStepRunnerToken) private readonly stepRunner?: WorkflowStepRunnerApi,
    @inject(WorkflowChildToken) private readonly children?: WorkflowChildApi,
    @inject(WorkflowHttpToken) private readonly http?: WorkflowHttpApi,
    @inject(WorkflowCredentialsToken) private readonly credentials?: WorkflowCredentialsApi,
    @inject(SpecRuntimeToken) private readonly connectors?: SpecRuntimeApi
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

  async [Symbol.asyncDispose](): Promise<void> {
    this.stopped = true;
    const scopeIds = [...this.active.keys()];
    for (const controller of this.active.values()) {
      controller.abort(new Error('Workflow coordinator disconnected'));
    }
    await Promise.all(scopeIds.map((scopeId) => this.data?.close(scopeId)));
  }

  async run(request: WorkflowRunRequest): Promise<WorkflowRunOutcome> {
    if (this.stopped) throw new Error('Workflow executor is disposed');
    recordRemoteTiming('received', {
      executionId: request.workflowRunId,
      scopeId: request.scopeId,
    });
    if (this.active.has(request.scopeId)) throw new Error('Remote scope is already executing');
    const controller = new AbortController();
    this.active.set(request.scopeId, controller);
    let outcome = 'failed';
    try {
      await this.data?.open(request.scopeId, request.credentials);
      const result = await this.execute(request, controller.signal);
      outcome = result.status;
      return result;
    } finally {
      this.active.delete(request.scopeId);
      try {
        await this.connectors?.close(request.scopeId);
      } finally {
        await this.data?.close(request.scopeId);
      }
      recordRemoteHeap('REMOTE_WORKER_HEAP', outcome);
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
      if (
        !request.dependencyPlan ||
        request.dependencyPlan.definitionHash !==
          workflowDefinitionHash(execution.workflowDefinition)
      ) {
        throw new Error('Workflow dependency plan does not match the execution definition');
      }
      const descriptions = await this.assertRunnable(execution.workflowDefinition);
      const resume =
        execution.status === ExecutionStatus.WAITING ||
        execution.status === ExecutionStatus.WAITING_FOR_INPUT ||
        execution.status === ExecutionStatus.WAITING_FOR_CHILD ||
        (execution.status === ExecutionStatus.RUNNING && Boolean(execution.currentNodeId));
      const importStarted = performance.now();
      const { runWorkflowEngineInWorker } = await import('./assemble_engine_loop');
      recordRemoteTiming('engine_import', {
        executionId: execution.id,
        durationMs: performance.now() - importStarted,
      });
      const credentials = this.credentials;
      const outcome = await runWorkflowEngineInWorker({
        execution,
        dependencyPlan: request.dependencyPlan,
        signal,
        scopeId: request.scopeId,
        spaceId: request.spaceId,
        steps: this.steps,
        storage: this.storage,
        log: this.log,
        resume,
        esClient: this.data?.user(request.scopeId),
        facts: request.facts,
        kibana: request.kibana,
        http: this.http,
        refreshRunCredential: credentials
          ? () => credentials.refreshRunCredential(request.scopeId)
          : undefined,
        children: this.children,
        finalize: () => this.connectors?.drain(request.scopeId) ?? Promise.resolve(),
        remoteSteps: this.stepRunner ? { runner: this.stepRunner, descriptions } : undefined,
      });
      return outcome;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.storage.complete(request.scopeId, {
        id: execution.id,
        status: ExecutionStatus.FAILED,
        error: { type: 'RemoteExecutionError', message },
        startedAt: execution.startedAt,
      });
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
      if (
        !this.stepRunner &&
        !CORE_STEP_TYPES.has(step.type) &&
        !step.type.startsWith('elasticsearch.') &&
        !step.type.startsWith('kibana.') &&
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
    // Catalog-supported (native contribution) types are optional: the coordinator describes them
    // when it also has a definition, but a catalog-only contribution must not be rejected.
    const optional = describedTypes.filter((type) => this.steps.supports(type));
    return this.stepRunner && describedTypes.length
      ? this.stepRunner.describe(describedTypes, { optional })
      : [];
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

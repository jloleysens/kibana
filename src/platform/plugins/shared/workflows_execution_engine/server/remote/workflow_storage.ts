/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { isMainThread, threadId } from 'node:worker_threads';
import { remotable } from '@kbn/core-remote-common';
import type { ScopeLookup } from '@kbn/core-remote-server';
import type { Logger } from '@kbn/logging';
import type { EsWorkflowExecution, EsWorkflowStepExecution } from '@kbn/workflows';
import { ExecutionStatus } from '@kbn/workflows-runtime';
import type { WorkflowStorageApi, WorkflowThreadIdentity } from './tokens';
import { assertWorkflowRunScope } from './workflow_run_scope';
import type {
  StepExecutionField,
  StepExecutionRepository,
} from '../repositories/step_execution_repository';
import type { WorkflowExecutionRepository } from '../repositories/workflow_execution_repository';

export interface WorkflowStorageCallbacks {
  scheduleResume(
    scopeId: string,
    workflowRunId: string,
    spaceId: string,
    resumeAt: string,
    kind?: 'resume' | 'global_timeout' | 'ensure_wake' | 'wake'
  ): Promise<{ taskId: string }>;
  executeConnector(
    scopeId: string,
    params: {
      connectorType: string;
      connectorNameOrId: string;
      input: Record<string, unknown>;
      system?: boolean;
    }
  ): Promise<unknown>;
}

const REFRESHED_STATUSES = new Set<EsWorkflowExecution['status']>([
  ExecutionStatus.WAITING,
  ExecutionStatus.WAITING_FOR_INPUT,
  ExecutionStatus.WAITING_FOR_CHILD,
  ExecutionStatus.COMPLETED,
  ExecutionStatus.FAILED,
  ExecutionStatus.CANCELLED,
  ExecutionStatus.TIMED_OUT,
]);

/**
 * Repository-backed persistence shared by Core-bound and direct worker clients.
 */
@remotable()
export class WorkflowStorage implements WorkflowStorageApi {
  constructor(
    private readonly workflowExecutionRepository: WorkflowExecutionRepository,
    private readonly stepExecutionRepository: StepExecutionRepository,
    private readonly logger: Logger,
    private readonly callbacks: WorkflowStorageCallbacks,
    private readonly scopes?: ScopeLookup
  ) {}

  whereAmI(): WorkflowThreadIdentity {
    return { threadId, isMainThread };
  }

  async getExecution(
    scopeId: string,
    workflowRunId: string,
    spaceId: string
  ): Promise<EsWorkflowExecution> {
    this.assertRun(scopeId, workflowRunId, spaceId);
    const execution = await this.workflowExecutionRepository.getWorkflowExecutionById(
      workflowRunId,
      spaceId
    );
    if (!execution) {
      throw new Error(`Workflow execution ${workflowRunId} was not found`);
    }
    return execution;
  }

  async markRunning(scopeId: string, workflowRunId: string, spaceId: string): Promise<void> {
    this.assertRun(scopeId, workflowRunId, spaceId);
    await this.workflowExecutionRepository.updateWorkflowExecution({
      id: workflowRunId,
      status: ExecutionStatus.RUNNING,
    });
  }

  async recordStep(scopeId: string, step: EsWorkflowStepExecution): Promise<void> {
    await this.assertSteps(scopeId, [step]);
    await this.stepExecutionRepository.bulkUpsert([step]);
  }

  async updateExecution(
    scopeId: string,
    execution: Partial<EsWorkflowExecution> & { id: string }
  ): Promise<void> {
    this.assertRun(scopeId, execution.id, execution.spaceId);
    if (
      this.scopes &&
      execution.workflowId !== undefined &&
      execution.workflowId !== this.scopes.getRunState(scopeId).workflowId
    )
      throw new Error('Workflow identity is outside the scoped execution');
    if (
      this.scopes &&
      [
        'managed',
        'workflowDefinition',
        'parentWorkflowExecutionId',
        'createdBy',
        'isTestRun',
        'effectiveIdentity',
        'executedBy',
      ].some((field) => field in execution)
    )
      throw new Error('Workflow identity cannot be changed by the executor');
    if (this.scopes && execution.context) {
      const original = await this.workflowExecutionRepository.getWorkflowExecutionById(
        execution.id,
        this.scopes.getRunState(scopeId).spaceId
      );
      for (const field of [
        'parentWorkflowExecutionId',
        'parentWorkflowId',
        'parentWorkflowInvocation',
        'parentDepth',
      ]) {
        if (field in execution.context && execution.context[field] !== original?.context?.[field])
          throw new Error('Workflow lineage identity cannot be changed by the executor');
      }
    }
    const refresh =
      execution.status && REFRESHED_STATUSES.has(execution.status) ? 'wait_for' : false;
    await this.workflowExecutionRepository.updateWorkflowExecution(execution, { refresh });
  }

  async getCancelState(
    scopeId: string,
    workflowRunId: string,
    spaceId: string
  ): Promise<Pick<EsWorkflowExecution, 'cancelRequested' | 'cancelledAt' | 'cancelledBy'> | null> {
    this.assertRun(scopeId, workflowRunId, spaceId);
    return this.workflowExecutionRepository.getWorkflowExecutionCancelState(workflowRunId, spaceId);
  }

  async upsertSteps(
    scopeId: string,
    steps: Array<Partial<EsWorkflowStepExecution>>
  ): Promise<void> {
    await this.assertSteps(scopeId, steps);
    await this.stepExecutionRepository.bulkUpsert(steps);
  }

  async getSteps(
    scopeId: string,
    ids: string[],
    sourceIncludes?: string[],
    sourceExcludes?: string[]
  ): Promise<EsWorkflowStepExecution[]> {
    if (this.scopes) {
      const existing = await this.stepExecutionRepository.getStepExecutionsByIds(ids);
      for (const step of existing) this.assertRun(scopeId, step.workflowRunId, step.spaceId);
    }
    return this.stepExecutionRepository.getStepExecutionsByIds(
      ids,
      sourceIncludes as StepExecutionField[] | undefined,
      sourceExcludes as StepExecutionField[] | undefined
    );
  }

  async scheduleResume(
    scopeId: string,
    workflowRunId: string,
    spaceId: string,
    resumeAt: string,
    kind?: 'resume' | 'global_timeout' | 'ensure_wake' | 'wake'
  ): Promise<{ taskId: string }> {
    this.assertRun(scopeId, workflowRunId, spaceId);
    return this.callbacks.scheduleResume(scopeId, workflowRunId, spaceId, resumeAt, kind);
  }

  async executeConnector(
    scopeId: string,
    params: {
      connectorType: string;
      connectorNameOrId: string;
      input: Record<string, unknown>;
      system?: boolean;
    }
  ): Promise<unknown> {
    this.scopes?.getRunState(scopeId);
    return this.callbacks.executeConnector(scopeId, params);
  }

  async complete(
    scopeId: string,
    update: {
      id: string;
      status: EsWorkflowExecution['status'];
      error?: EsWorkflowExecution['error'];
      startedAt?: string;
    }
  ): Promise<void> {
    this.assertRun(scopeId, update.id);
    const finishedAt = new Date();
    const startedAt = update.startedAt
      ? new Date(update.startedAt).getTime()
      : finishedAt.getTime();
    await this.workflowExecutionRepository.updateWorkflowExecution(
      {
        id: update.id,
        status: update.status,
        error: update.error,
        finishedAt: finishedAt.toISOString(),
        duration: Math.max(0, finishedAt.getTime() - startedAt),
      },
      { refresh: 'wait_for' }
    );
    this.logger.debug(`Remote workflow execution ${update.id} stored as ${update.status}`);
  }

  private assertRun(scopeId: string, id: string, spaceId?: string): void {
    if (this.scopes) assertWorkflowRunScope(this.scopes, scopeId, id, spaceId);
  }

  private async assertSteps(
    scopeId: string,
    steps: Array<Partial<EsWorkflowStepExecution>>
  ): Promise<void> {
    if (!this.scopes) return;
    this.scopes.getRunState(scopeId);
    for (const step of steps) {
      if (!step.id) throw new Error('Missing scoped step identity');
      const [existing] = await this.stepExecutionRepository.getStepExecutionsByIds([step.id]);
      if (existing) this.assertRun(scopeId, existing.workflowRunId, existing.spaceId);
      const workflowRunId = step.workflowRunId ?? existing?.workflowRunId;
      const spaceId = step.spaceId ?? existing?.spaceId;
      if (!workflowRunId || !spaceId) throw new Error('Missing scoped step identity');
      this.assertRun(scopeId, workflowRunId, spaceId);
    }
  }
}

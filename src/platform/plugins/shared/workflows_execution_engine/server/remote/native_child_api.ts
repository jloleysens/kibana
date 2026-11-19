/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { KibanaRequest } from '@kbn/core/server';
import { remotable } from '@kbn/core-remote-common';
import type { ScopeLookup } from '@kbn/core-remote-server';
import {
  type EsWorkflow,
  toWorkflowExecutionEngineModel,
  type WorkflowRepository,
} from '@kbn/workflows';
import { WORKFLOW_STEP_TRIGGER_SOURCE } from '@kbn/workflows-runtime';
import type { WorkflowChildApi } from './tokens';
import { assertWorkflowRunScope } from './workflow_run_scope';
import type { WorkflowsExecutionEngineConfig } from '../config';
import type { StepExecutionRepository } from '../repositories/step_execution_repository';
import type { WorkflowExecutionRepository } from '../repositories/workflow_execution_repository';
import { buildChildLineageContext } from '../step/workflow_execute_step/build_child_lineage_context';
import type { WorkflowsExecutionEnginePluginStart } from '../types';

/** Retains child admission and Task Manager identity on coordinator, not the child step algorithm. */
@remotable()
export class NativeChildApi implements WorkflowChildApi {
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly workflows: Pick<WorkflowRepository, 'getWorkflow'>,
    private readonly executions: Pick<WorkflowExecutionRepository, 'getWorkflowExecutionById'>,
    private readonly steps: Pick<StepExecutionRepository, 'getStepExecutionsByWorkflowExecution'>,
    private readonly engine: () => Pick<
      WorkflowsExecutionEnginePluginStart,
      'executeWorkflow' | 'cancelWorkflowExecution'
    >,
    private readonly config: Pick<WorkflowsExecutionEngineConfig, 'maxWorkflowDepth'>,
    private readonly canExecute: (
      workflow: EsWorkflow,
      request: KibanaRequest,
      spaceId: string
    ) => Promise<boolean>
  ) {}

  async getWorkflow(
    ...args: Parameters<WorkflowChildApi['getWorkflow']>
  ): ReturnType<WorkflowChildApi['getWorkflow']> {
    const [scopeId, parentId, spaceId, workflowId] = args;
    assertWorkflowRunScope(this.scopes, scopeId, parentId, spaceId);
    const parent = await this.executions.getWorkflowExecutionById(parentId, spaceId);
    if (!parent) throw new Error('Parent workflow execution not found');
    const workflow = await this.workflows.getWorkflow(workflowId, spaceId, {
      includeGlobal: parent.managed === true,
      managedFilter: parent.managed === true ? 'all' : 'unmanaged',
    });
    if (
      workflow &&
      !(await this.canExecute(workflow, this.scopes.get<KibanaRequest>(scopeId), spaceId))
    )
      throw new Error('You do not have permission to execute this workflow');
    return workflow;
  }

  async start(
    ...args: Parameters<WorkflowChildApi['start']>
  ): ReturnType<WorkflowChildApi['start']> {
    const [scopeId, parentId, spaceId, request] = args;
    assertWorkflowRunScope(this.scopes, scopeId, parentId, spaceId);
    const fakeRequest = this.scopes.get<KibanaRequest>(scopeId);
    const signal = this.scopes.getAbortSignal(scopeId);
    signal.throwIfAborted();
    const parent = await this.executions.getWorkflowExecutionById(parentId, spaceId);
    if (!parent) throw new Error('Parent workflow execution not found');
    const workflow = await this.getWorkflow(scopeId, parentId, spaceId, request.workflowId);
    if (!workflow) throw new Error(`Workflow not found: "${request.workflowId}"`);
    const rawDepth = parent.context?.parentDepth;
    const parentDepth = (typeof rawDepth === 'number' ? rawDepth : -1) + 1;
    if (parentDepth >= this.config.maxWorkflowDepth)
      throw new Error('Workflow composition depth limit exceeded');
    if (workflow.id === parent.workflowId) throw new Error('Workflow cannot call itself');
    if (!workflow.valid || !workflow.enabled) throw new Error('Child workflow is not executable');
    this.scopes.getAbortSignal(scopeId).throwIfAborted();
    const result = await this.engine().executeWorkflow(
      toWorkflowExecutionEngineModel(workflow, {
        isTestRun: !!parent.isTestRun,
        isEphemeral: false,
      }),
      {
        spaceId,
        inputs: request.inputs,
        triggeredBy: WORKFLOW_STEP_TRIGGER_SOURCE,
        parentWorkflowInvocation: request.invocation,
        parentWorkflowId: parent.workflowId,
        parentWorkflowExecutionId: parent.id,
        parentStepId: request.stepId,
        parentDepth,
        ...buildChildLineageContext({ invocation: request.invocation, parent }),
        ...(request.inheritParentIdentity
          ? { inheritParentIdentity: true, parentStepName: request.stepId }
          : {}),
      },
      fakeRequest
    );
    if (!signal.aborted) this.scopes.admitChild(scopeId, result.workflowExecutionId);
    if (signal.aborted) {
      await this.engine().cancelWorkflowExecution(result.workflowExecutionId, spaceId, fakeRequest);
      signal.throwIfAborted();
    }
    return result;
  }

  async getExecution(
    ...args: Parameters<WorkflowChildApi['getExecution']>
  ): ReturnType<WorkflowChildApi['getExecution']> {
    const [scopeId, id, spaceId] = args;
    this.assertAdmitted(scopeId, id, spaceId);
    return this.executions.getWorkflowExecutionById(id, spaceId);
  }

  async getSteps(
    ...args: Parameters<WorkflowChildApi['getSteps']>
  ): ReturnType<WorkflowChildApi['getSteps']> {
    const [scopeId, id, ids] = args;
    const state = this.assertAdmitted(scopeId, id);
    const execution = await this.executions.getWorkflowExecutionById(id, state.spaceId);
    if (!execution) return [];
    const allowedIds = execution.stepExecutionIds;
    if (ids?.some((stepId) => !allowedIds?.includes(stepId)))
      throw new Error('Workflow step is outside the scoped execution');
    const steps = await this.steps.getStepExecutionsByWorkflowExecution(id, ids ?? allowedIds);
    if (steps.some((step) => step.workflowRunId !== id || step.spaceId !== state.spaceId))
      throw new Error('Workflow step is outside the scoped execution');
    return steps;
  }

  async cancel(
    ...args: Parameters<WorkflowChildApi['cancel']>
  ): ReturnType<WorkflowChildApi['cancel']> {
    const [scopeId, id, spaceId] = args;
    this.assertAdmitted(scopeId, id, spaceId);
    return this.engine().cancelWorkflowExecution(
      id,
      spaceId,
      this.scopes.get<KibanaRequest>(scopeId)
    );
  }

  private assertAdmitted(
    scopeId: string,
    id: string,
    spaceId?: string
  ): ReturnType<ScopeLookup['getRunState']> {
    this.scopes.get<KibanaRequest>(scopeId);
    const state = this.scopes.getRunState(scopeId);
    if (spaceId !== undefined && spaceId !== state.spaceId)
      throw new Error('Workflow resource is outside the scoped execution');
    if (id !== state.workflowRunId && !state.admittedChildren.has(id))
      throw new Error('Workflow execution is not an admitted child');
    return state;
  }
}

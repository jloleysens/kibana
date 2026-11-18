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
import { toWorkflowExecutionEngineModel, type WorkflowRepository } from '@kbn/workflows';
import { WORKFLOW_STEP_TRIGGER_SOURCE } from '@kbn/workflows-runtime';
import type { WorkflowChildApi } from './tokens';
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
    private readonly config: Pick<WorkflowsExecutionEngineConfig, 'maxWorkflowDepth'>
  ) {}

  async getWorkflow(
    ...args: Parameters<WorkflowChildApi['getWorkflow']>
  ): ReturnType<WorkflowChildApi['getWorkflow']> {
    const [scopeId, parentId, spaceId, workflowId] = args;
    this.scopes.get<KibanaRequest>(scopeId);
    const parent = await this.executions.getWorkflowExecutionById(parentId, spaceId);
    if (!parent) throw new Error('Parent workflow execution not found');
    return this.workflows.getWorkflow(workflowId, spaceId, {
      includeGlobal: parent.managed === true,
      managedFilter: parent.managed === true ? 'all' : 'unmanaged',
    });
  }

  async start(
    ...args: Parameters<WorkflowChildApi['start']>
  ): ReturnType<WorkflowChildApi['start']> {
    const [scopeId, parentId, spaceId, request] = args;
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
    this.scopes.get<KibanaRequest>(scopeId);
    return this.executions.getWorkflowExecutionById(id, spaceId);
  }

  async getSteps(
    ...args: Parameters<WorkflowChildApi['getSteps']>
  ): ReturnType<WorkflowChildApi['getSteps']> {
    const [scopeId, id, ids] = args;
    this.scopes.get<KibanaRequest>(scopeId);
    return this.steps.getStepExecutionsByWorkflowExecution(id, ids);
  }

  async cancel(
    ...args: Parameters<WorkflowChildApi['cancel']>
  ): ReturnType<WorkflowChildApi['cancel']> {
    const [scopeId, id, spaceId] = args;
    return this.engine().cancelWorkflowExecution(
      id,
      spaceId,
      this.scopes.get<KibanaRequest>(scopeId)
    );
  }
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import { createToken } from '@kbn/core-di';
import type {
  EsWorkflow,
  EsWorkflowExecution,
  EsWorkflowStepExecution,
  SerializedError,
  StackFrame,
} from '@kbn/workflows';
import type {
  PollCeilings,
  PollHandlerContext,
  PollPolicy,
  StepHandlerContext,
} from '@kbn/workflows-extensions/server';

import type { ElasticsearchRequestDefinition } from '@kbn/workflows-runtime';
import type { StepDependencyPlan } from '../workflow_context_manager/step_dependency_plan';

/**
 * Same stable id as Workflows Extensions' catalogue token. Reconstructed independently in each
 * isolate so the executor does not import that plugin.
 */
export const WorkflowStepCatalogToken =
  createToken<WorkflowStepCatalogApi>('workflows.stepCatalog');

export interface WorkflowStepCatalogApi {
  supports(stepType: string): boolean;
  run(
    stepType: string,
    scopeId: string,
    input: unknown,
    context: {
      /** Executor-local only; never forwarded to coordinator capabilities. */
      readonly handlerContext?: StepHandlerContext;
      readonly attribution?: {
        readonly type: string;
        readonly id: string;
        readonly name: string;
        readonly runId: string;
      };
    }
  ): Promise<unknown>;
}

export interface WorkflowThreadIdentity {
  readonly threadId: number;
  readonly isMainThread: boolean;
}

export interface WorkflowStorageApi {
  getExecution(
    scopeId: string,
    workflowRunId: string,
    spaceId: string
  ): Promise<EsWorkflowExecution>;
  markRunning(scopeId: string, workflowRunId: string, spaceId: string): Promise<void>;
  recordStep(scopeId: string, step: EsWorkflowStepExecution): Promise<void>;
  /** Merges a partial execution document. The engine loop persists through this, not `complete`. */
  updateExecution(
    scopeId: string,
    execution: Partial<EsWorkflowExecution> & { id: string }
  ): Promise<void>;
  getCancelState(
    scopeId: string,
    workflowRunId: string,
    spaceId: string
  ): Promise<Pick<EsWorkflowExecution, 'cancelRequested' | 'cancelledAt' | 'cancelledBy'> | null>;
  upsertSteps(scopeId: string, steps: Array<Partial<EsWorkflowStepExecution>>): Promise<void>;
  getSteps(
    scopeId: string,
    ids: string[],
    sourceIncludes?: string[],
    sourceExcludes?: string[]
  ): Promise<EsWorkflowStepExecution[]>;
  /** Asks the coordinator to schedule the existing resume task. */
  scheduleResume(
    scopeId: string,
    workflowRunId: string,
    spaceId: string,
    resumeAt: string,
    kind?: 'resume' | 'global_timeout' | 'ensure_wake' | 'wake'
  ): Promise<{ taskId: string }>;
  /**
   * Asks the coordinator to run a connector with the execution's user.
   * Present so a later human-input step can send its message without a new protocol.
   */
  executeConnector(
    scopeId: string,
    params: {
      connectorType: string;
      connectorNameOrId: string;
      input: Record<string, unknown>;
      system?: boolean;
    }
  ): Promise<unknown>;
  complete(
    scopeId: string,
    update: {
      id: string;
      status: EsWorkflowExecution['status'];
      error?: EsWorkflowExecution['error'];
      startedAt?: string;
    }
  ): Promise<void>;
  whereAmI(): Promise<WorkflowThreadIdentity> | WorkflowThreadIdentity;
}

export interface WorkflowLogApi {
  info(message: string): Promise<void> | void;
  /** Persists one flush of the engine event queue. */
  write(events: readonly object[]): Promise<void> | void;
}

export interface WorkflowRunOutcome {
  readonly status: string;
  readonly failedStepContext?: {
    readonly stepId: string;
    readonly stepName: string;
    readonly stepExecutionId: string;
  };
}

export interface WorkflowExecutorApi {
  run(request: WorkflowRunRequest): Promise<WorkflowRunOutcome>;
  cancel(scopeId: string, reason?: 'task_manager'): Promise<void>;
  placement(): Promise<{
    executor: WorkflowThreadIdentity;
    storage: WorkflowThreadIdentity;
  }>;
  block(milliseconds: number): Promise<number>;
}

/** Same stable id as the Workflows Extensions contribution kind. */
export const WorkflowStepKind = createToken<unknown>('workflows.step');

export const WorkflowStorageToken = createToken<WorkflowStorageApi>('workflows.storage');
export const WorkflowLogToken = createToken<WorkflowLogApi>('workflows.log');
export const WorkflowExecutorToken = createToken<WorkflowExecutorApi>('workflows.executor');

export interface WorkflowDispatchCredentials {
  readonly node: string;
  readonly internalHeaders: Readonly<Record<string, string>>;
  readonly userHeaders: Readonly<Record<string, string>>;
}

export interface WorkflowDataPlaneApi {
  open(scopeId: string, credentials?: WorkflowDispatchCredentials): Promise<void>;
  close(scopeId: string): Promise<void>;
  internal(scopeId?: string): ElasticsearchClient;
  user(scopeId: string): ElasticsearchClient;
}

export type WorkflowControlApi = Pick<WorkflowStorageApi, 'scheduleResume' | 'executeConnector'> & {
  persistence(): Promise<WorkflowStorageApi | null>;
  info(message: string): void | Promise<void>;
  initializeLogs(): Promise<void>;
};

export const WorkflowDataPlaneToken = createToken<WorkflowDataPlaneApi>('workflows.dataPlane');
export const WorkflowControlToken = createToken<WorkflowControlApi>('workflows.control');

export interface WorkflowRunRequest {
  readonly dependencyPlan: StepDependencyPlan;
  readonly scopeId: string;
  readonly workflowRunId: string;
  readonly spaceId: string;
  readonly credentials?: WorkflowDispatchCredentials;
  readonly facts?: WorkflowDispatchFacts;
}

export interface WorkflowStepDescription {
  readonly elasticsearch?: ElasticsearchRequestDefinition;
  readonly isSpecConnector?: boolean;
  readonly type: string;
  readonly mode: 'handler' | 'poll' | 'native' | 'connector' | 'node';
  readonly configKeys: readonly string[];
  readonly hasStart: boolean;
  readonly hasOnCancel: boolean;
  readonly policy?: PollPolicy;
  readonly ceilings?: PollCeilings;
  readonly digest: string;
}

export interface WorkflowStepInvocation {
  readonly invocationId: string;
  readonly scopeId: string;
  readonly executionId: string;
  readonly spaceId: string;
  readonly nodeId: string;
  readonly stackFrames: StackFrame[];
  readonly description: WorkflowStepDescription;
  readonly phase: 'handler' | 'start' | 'poll' | 'onCancel' | 'node' | 'nodeCancel';
  readonly now: Date;
  readonly aborted: boolean;
}

export interface WorkflowStepResult {
  readonly output?: StepHandlerContext['input'];
  readonly state?: PollHandlerContext['state'];
  readonly nextPollDelayMs?: number;
  readonly error?: SerializedError;
}

export interface WorkflowStepRunnerApi {
  describe(
    stepTypes: readonly string[],
    options?: { optional?: readonly string[] }
  ): Promise<WorkflowStepDescription[]>;
  invoke(
    request: WorkflowStepInvocation | WorkflowConnectorInvocation
  ): Promise<WorkflowStepResult | undefined>;
  cancel(invocationId: string): Promise<void>;
}

export const WorkflowStepRunnerToken = createToken<WorkflowStepRunnerApi>('workflows.stepRunner');

export interface WorkflowConnectorInvocation {
  readonly invocationId: string;
  readonly scopeId: string;
  readonly phase: 'connector';
  readonly system?: boolean;
  readonly connectorType: string;
  readonly connectorNameOrId: string;
  readonly input: Parameters<WorkflowStorageApi['executeConnector']>[1]['input'];
  readonly aborted: boolean;
}

export interface WorkflowDispatchFacts {
  readonly kibanaUrl: string;
  readonly maxResponseSizeBytes: number;
  readonly evictionMinBytes: number;
  readonly hitlExternalResumeEnabled?: boolean;
  readonly maxWorkflowDepth?: number;
}

export interface WorkflowChildApi {
  getWorkflow(
    scopeId: string,
    parentId: string,
    spaceId: string,
    workflowId: string
  ): Promise<EsWorkflow | null>;
  start(
    scopeId: string,
    parentId: string,
    spaceId: string,
    request: {
      readonly workflowId: string;
      readonly inputs: Record<string, unknown>;
      readonly stepId: string;
      readonly invocation: 'sync' | 'async';
      readonly inheritParentIdentity: boolean;
    }
  ): Promise<{ workflowExecutionId: string }>;
  getExecution(scopeId: string, id: string, spaceId: string): Promise<EsWorkflowExecution | null>;
  getSteps(scopeId: string, id: string, ids?: string[]): Promise<EsWorkflowStepExecution[]>;
  cancel(scopeId: string, id: string, spaceId: string): Promise<void>;
}

export const WorkflowChildToken = createToken<WorkflowChildApi>('workflows.child');

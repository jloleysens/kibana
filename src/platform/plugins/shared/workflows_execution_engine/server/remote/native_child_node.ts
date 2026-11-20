/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { recordRemoteTiming } from '@kbn/core-remote-common';
import type { WorkflowExecuteAsyncGraphNode, WorkflowExecuteGraphNode } from '@kbn/workflows/graph';
import type { WorkflowChildApi } from './tokens';
import type { CancellableNode, NodeImplementation } from '../step/node_implementation';
import type { WorkflowExecuteStepImpl } from '../step/workflow_execute_step/workflow_execute_step_impl';
import type { StepExecutionRuntime } from '../workflow_context_manager/step_execution_runtime';
import type { StepIoService } from '../workflow_context_manager/step_io_service';
import type { WorkflowExecutionRuntimeManager } from '../workflow_context_manager/workflow_execution_runtime_manager';

/** Runs the original child step and strategies locally; only child data/admission crosses RPC. */
export const createNativeChildNode = ({
  children,
  scopeId,
  runtime,
  workflowRuntime,
  stepIoService,
  maxWorkflowDepth,
}: {
  children: WorkflowChildApi;
  scopeId: string;
  runtime: StepExecutionRuntime;
  workflowRuntime: WorkflowExecutionRuntimeManager;
  stepIoService: StepIoService;
  maxWorkflowDepth: number;
}): NodeImplementation & CancellableNode => {
  let implementation: Promise<WorkflowExecuteStepImpl> | undefined;
  let activeRun: Promise<void> | undefined;
  const getImplementation = async () => {
    if (!implementation) {
      implementation = (async () => {
        const started = performance.now();
        const { WorkflowExecuteStepImpl: ChildStep } = await import(
          '../step/workflow_execute_step/workflow_execute_step_impl'
        );
        recordRemoteTiming('child_import', {
          executionId: runtime.workflowExecution.id,
          stepType: runtime.node.stepType,
          durationMs: performance.now() - started,
        });
        const { id: parentId, spaceId } = runtime.workflowExecution;
        return new ChildStep({
          node: runtime.node as WorkflowExecuteGraphNode | WorkflowExecuteAsyncGraphNode,
          stepExecutionRuntime: runtime,
          workflowExecutionRuntime: workflowRuntime,
          workflowRepository: {
            getWorkflow: (id) => children.getWorkflow(scopeId, parentId, spaceId, id),
          },
          workflowExecutionRepository: {
            getWorkflowExecutionById: (id, space) => children.getExecution(scopeId, id, space),
          },
          stepExecutionRepository: {
            getStepExecutionsByWorkflowExecution: (id, ids) => children.getSteps(scopeId, id, ids),
          },
          workflowsExecutionEngine: {
            executeWorkflow: async (workflow, context) => {
              await stepIoService.flush();
              runtime.abortController.signal.throwIfAborted();
              const inputs = context.inputs;
              if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs))
                throw new Error('Invalid child inputs');
              return children.start(scopeId, parentId, spaceId, {
                workflowId: workflow.id,
                inputs: inputs as Record<string, unknown>,
                stepId: runtime.node.stepId,
                invocation: runtime.node.stepType === 'workflow.execute' ? 'sync' : 'async',
                inheritParentIdentity: context.inheritParentIdentity === true,
              });
            },
            cancelWorkflowExecution: (id, space) => children.cancel(scopeId, id, space),
          },
          spaceId,
          request: runtime.contextManager.getFakeRequest(),
          workflowLogger: runtime.stepLogger,
          config: { maxWorkflowDepth },
        });
      })();
    }
    return implementation;
  };
  return {
    run: () => {
      activeRun = (async () => {
        const instance = await getImplementation();
        runtime.abortController.signal.throwIfAborted();
        recordRemoteTiming('child_handler', {
          executionId: runtime.workflowExecution.id,
          stepType: runtime.node.stepType,
          stepId: runtime.node.stepId,
        });
        await instance.run();
      })();
      return activeRun;
    },
    onCancel: async () => {
      if (activeRun) await Promise.allSettled([activeRun]);
      await (await getImplementation()).onCancel();
    },
  };
};

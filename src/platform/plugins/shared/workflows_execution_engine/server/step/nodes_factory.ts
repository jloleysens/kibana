/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type {
  AtomicGraphNode,
  EnterCaseBranchNode,
  EnterConditionBranchNode,
  EnterContinueNode,
  EnterDefaultBranchNode,
  EnterForeachNode,
  EnterIfNode,
  EnterParallelNode,
  EnterRetryNode,
  EnterSwitchNode,
  EnterTryBlockNode,
  EnterWhileNode,
  ExitCaseBranchNode,
  ExitConditionBranchNode,
  ExitDefaultBranchNode,
  ExitFallbackPathNode,
  ExitForeachNode,
  ExitNormalPathNode,
  ExitRetryNode,
  ExitWhileNode,
  LoopBreakNode,
  LoopContinueNode,
  WaitForApprovalGraphNode,
  WaitForInputGraphNode,
  WaitGraphNode,
  WorkflowExecuteAsyncGraphNode,
  WorkflowExecuteGraphNode,
  WorkflowOutputGraphNode,
} from '@kbn/workflows/graph';
import {
  isDataSet,
  isEnterStepTimeoutZone,
  isEnterWorkflowTimeoutZone,
  isExitStepTimeoutZone,
  isExitWorkflowTimeoutZone,
} from '@kbn/workflows/graph';
import type { ElasticsearchGraphNode, KibanaGraphNode } from '@kbn/workflows/graph/types';
import type { NodeImplementation } from './node_implementation';
import type { ConnectorExecutor } from '../connector_executor';
import type { StepExecutionRuntime } from '../workflow_context_manager/step_execution_runtime';
import type { StepExecutionRuntimeFactory } from '../workflow_context_manager/step_execution_runtime_factory';
import type { StepIoService } from '../workflow_context_manager/step_io_service';
import type { ContextDependencies } from '../workflow_context_manager/types';
import type { WorkflowExecutionRuntimeManager } from '../workflow_context_manager/workflow_execution_runtime_manager';
import type { WorkflowRuntimeGraph } from '../workflow_context_manager/workflow_runtime_graph';
import type { IWorkflowEventLogger } from '../workflow_event_logger';

export class NodesFactory {
  constructor(
    private connectorExecutor: ConnectorExecutor, // this is temporary, we will remove it when we have a proper connector executor
    private workflowRuntime: WorkflowExecutionRuntimeManager,
    private workflowLogger: IWorkflowEventLogger, // Assuming you have a logger interface
    private workflowGraph: WorkflowRuntimeGraph,
    private stepExecutionRuntimeFactory: StepExecutionRuntimeFactory,
    private dependencies: ContextDependencies,
    private stepIoService: StepIoService
  ) {}

  public async create(stepExecutionRuntime: StepExecutionRuntime): Promise<NodeImplementation> {
    const { node } = stepExecutionRuntime;

    // Built-in steps - checked first before workflows_extensions
    // Note: Some built-in steps (like data.set) are also registered in workflows_extensions
    // for YAML schema validation, but execution always uses the built-in implementation.
    // This dual-registration is intentional: workflows_extensions provides the schema,
    // while the execution engine provides the implementation with access to internal APIs.

    // Handle elasticsearch.* and kibana.* actions
    if (node.stepType && node.stepType.startsWith('elasticsearch.')) {
      this.workflowLogger.logDebug(`Creating Elasticsearch action step: ${node.stepType}`, {
        event: { action: 'internal-action-creation', outcome: 'success' },
        tags: ['step-factory', 'elasticsearch', 'internal-action'],
      });
      return new (await import('./elasticsearch_action_step')).ElasticsearchActionStepImpl(
        node as ElasticsearchGraphNode,
        stepExecutionRuntime,
        this.workflowRuntime,
        stepExecutionRuntime.stepLogger
      );
    }

    if (node.stepType && node.stepType.startsWith('kibana.')) {
      this.workflowLogger.logDebug(`Creating Kibana action step: ${node.stepType}`, {
        event: { action: 'internal-action-creation', outcome: 'success' },
        tags: ['step-factory', 'kibana', 'internal-action'],
      });
      return new (await import('./kibana_action_step')).KibanaActionStepImpl(
        node as KibanaGraphNode,
        stepExecutionRuntime,
        this.workflowRuntime,
        stepExecutionRuntime.stepLogger
      );
    }

    // Handle data.set internal step
    if (isDataSet(node)) {
      this.workflowLogger.logDebug('Creating data.set step', {
        event: { action: 'internal-step-creation', outcome: 'success' },
        tags: ['step-factory', 'data-set', 'internal-step'],
      });
      return new (await import('./data_set_step')).DataSetStepImpl(
        node,
        stepExecutionRuntime,
        this.workflowRuntime,
        stepExecutionRuntime.stepLogger
      );
    }

    // Check for custom registered step types first
    const { workflowsExtensions } = this.dependencies;
    if (node.stepType && workflowsExtensions.hasStepDefinition(node.stepType)) {
      const stepDefinition =
        this.dependencies.remoteStepDefinition?.(node.stepType, stepExecutionRuntime) ??
        workflowsExtensions.getStepDefinition(node.stepType);
      if (stepDefinition) {
        this.workflowLogger.logDebug(`Creating custom registered step: ${node.stepType}`, {
          event: { action: 'custom-step-creation', outcome: 'success' },
          tags: ['step-handler', 'custom-step', 'extension'],
        });
        return new (await import('./custom_step_impl')).CustomStepImpl(
          node as AtomicGraphNode,
          stepDefinition,
          stepExecutionRuntime,
          this.connectorExecutor,
          this.workflowRuntime,
          stepExecutionRuntime.stepLogger
        );
      }
    }

    return this.createGenericStepNode(stepExecutionRuntime);
  }

  // eslint-disable-next-line complexity
  private async createGenericStepNode(
    stepExecutionRuntime: StepExecutionRuntime
  ): Promise<NodeImplementation> {
    const node = stepExecutionRuntime.node;
    const stepLogger = stepExecutionRuntime.stepLogger;
    switch (node.type) {
      case 'enter-foreach':
        return new (await import('./foreach_step')).EnterForeachNodeImpl(
          node as EnterForeachNode,
          this.workflowRuntime,
          stepExecutionRuntime,
          stepLogger,
          this.stepIoService
        );
      case 'enter-foreach-iteration':
        return new (await import('./foreach_step')).EnterForeachIterationNodeImpl(
          node,
          this.workflowRuntime,
          stepExecutionRuntime,
          this.stepExecutionRuntimeFactory
        );
      case 'exit-foreach-iteration':
        return new (await import('./foreach_step')).ExitForeachIterationNodeImpl(
          stepExecutionRuntime,
          this.workflowRuntime
        );
      case 'exit-foreach':
        return new (await import('./foreach_step')).ExitForeachNodeImpl(
          node as ExitForeachNode,
          stepExecutionRuntime,
          this.workflowRuntime,
          stepLogger,
          this.stepIoService,
          this.workflowGraph
        );
      case 'enter-while':
        return new (await import('./while_step')).EnterWhileNodeImpl(
          node as EnterWhileNode,
          this.workflowRuntime,
          stepExecutionRuntime,
          stepLogger,
          this.stepIoService
        );
      case 'exit-while':
        return new (await import('./while_step')).ExitWhileNodeImpl(
          node as ExitWhileNode,
          stepExecutionRuntime,
          this.workflowRuntime,
          stepLogger,
          this.stepIoService,
          this.workflowGraph
        );
      case 'enter-parallel':
        return new (await import('./parallel_step')).EnterParallelNodeImpl(
          node as EnterParallelNode,
          this.workflowRuntime,
          stepExecutionRuntime,
          stepLogger,
          this.stepExecutionRuntimeFactory,
          this,
          this.workflowGraph
        );
      case 'exit-parallel':
        return new (await import('./parallel_step')).ExitParallelNodeImpl(this.workflowRuntime);
      case 'loop-break':
        return new (await import('./flow_control_step')).LoopBreakNodeImpl(
          node as LoopBreakNode,
          stepExecutionRuntime,
          this.workflowRuntime,
          stepLogger,
          this.stepExecutionRuntimeFactory,
          this.stepIoService,
          this.workflowGraph
        );
      case 'loop-continue':
        return new (await import('./flow_control_step')).LoopContinueNodeImpl(
          node as LoopContinueNode,
          stepExecutionRuntime,
          this.workflowRuntime,
          stepLogger,
          this.stepExecutionRuntimeFactory,
          this.stepIoService,
          this.workflowGraph
        );
      case 'enter-retry':
        return new (await import('./on_failure/retry_step')).EnterRetryNodeImpl(
          node as EnterRetryNode,
          stepExecutionRuntime,
          this.workflowRuntime,
          stepLogger
        );
      case 'exit-retry':
        return new (await import('./on_failure/retry_step')).ExitRetryNodeImpl(
          node as ExitRetryNode,
          stepExecutionRuntime,
          this.workflowRuntime,
          stepLogger
        );
      case 'enter-continue':
        return new (await import('./on_failure/continue_step')).EnterContinueNodeImpl(
          node as EnterContinueNode,
          this.workflowRuntime,
          stepLogger
        );
      case 'exit-continue':
        return new (await import('./on_failure/continue_step')).ExitContinueNodeImpl(
          this.workflowRuntime
        );
      case 'enter-try-block':
        return new (await import('./on_failure/fallback_step')).EnterTryBlockNodeImpl(
          node as EnterTryBlockNode,
          stepExecutionRuntime,
          this.workflowRuntime
        );
      case 'exit-try-block':
        return new (await import('./on_failure/fallback_step')).ExitTryBlockNodeImpl(
          stepExecutionRuntime,
          this.workflowRuntime
        );
      case 'enter-normal-path':
        return new (await import('./on_failure/fallback_step')).EnterNormalPathNodeImpl(
          this.workflowRuntime
        );
      case 'enter-fallback-path':
        return new (await import('./on_failure/fallback_step')).EnterFallbackPathNodeImpl(
          this.workflowRuntime
        );
      case 'exit-normal-path':
        return new (await import('./on_failure/fallback_step')).ExitNormalPathNodeImpl(
          node as ExitNormalPathNode,
          this.workflowRuntime
        );
      case 'exit-fallback-path':
        return new (await import('./on_failure/fallback_step')).ExitFallbackPathNodeImpl(
          node as ExitFallbackPathNode,
          this.workflowRuntime
        );
      case 'enter-timeout-zone':
        if (isEnterWorkflowTimeoutZone(node)) {
          return new (await import('./timeout_zone_step')).EnterWorkflowTimeoutZoneNodeImpl(
            node,
            this.workflowRuntime,
            this.stepExecutionRuntimeFactory
          );
        }

        if (isEnterStepTimeoutZone(node)) {
          return new (await import('./timeout_zone_step')).EnterStepTimeoutZoneNodeImpl(
            node,
            this.workflowRuntime,
            stepExecutionRuntime
          );
        }
      case 'exit-timeout-zone':
        if (isExitWorkflowTimeoutZone(node)) {
          return new (await import('./timeout_zone_step')).ExitWorkflowTimeoutZoneNodeImpl(
            this.workflowRuntime
          );
        }

        if (isExitStepTimeoutZone(node)) {
          return new (await import('./timeout_zone_step')).ExitStepTimeoutZoneNodeImpl(
            stepExecutionRuntime,
            this.workflowRuntime
          );
        }
      case 'enter-if':
        return new (await import('./if_step')).EnterIfNodeImpl(
          node as EnterIfNode,
          this.workflowRuntime,
          this.workflowGraph,
          stepExecutionRuntime,
          stepLogger
        );
      case 'enter-then-branch':
      case 'enter-else-branch':
        return new (await import('./if_step')).EnterConditionBranchNodeImpl(
          node as EnterConditionBranchNode,
          this.workflowRuntime
        );
      case 'exit-then-branch':
      case 'exit-else-branch':
        return new (await import('./if_step')).ExitConditionBranchNodeImpl(
          node as ExitConditionBranchNode,
          this.workflowGraph,
          this.workflowRuntime
        );
      case 'exit-if':
        return new (await import('./if_step')).ExitIfNodeImpl(
          stepExecutionRuntime,
          this.workflowRuntime
        );
      case 'enter-switch':
        return new (await import('./switch_step')).EnterSwitchNodeImpl(
          node as EnterSwitchNode,
          this.workflowRuntime,
          this.workflowGraph,
          stepExecutionRuntime,
          stepLogger
        );
      case 'enter-case-branch':
      case 'enter-default-branch':
        return new (await import('./switch_step')).EnterBranchNodeImpl(
          node as EnterCaseBranchNode | EnterDefaultBranchNode,
          this.workflowRuntime,
          stepExecutionRuntime
        );
      case 'exit-case-branch':
      case 'exit-default-branch':
        return new (await import('./switch_step')).ExitBranchNodeImpl(
          node as ExitCaseBranchNode | ExitDefaultBranchNode,
          this.workflowGraph,
          this.workflowRuntime
        );
      case 'exit-switch':
        return new (await import('./switch_step')).ExitSwitchNodeImpl(
          stepExecutionRuntime,
          this.workflowRuntime
        );
      case 'wait':
        return new (await import('./wait_step/wait_step')).WaitStepImpl(
          node as WaitGraphNode,
          stepExecutionRuntime,
          this.workflowRuntime,
          stepLogger
        );
      case 'waitForInput':
        return new (await import('./wait_for_input_step/wait_for_input_step')).WaitForInputStepImpl(
          node as WaitForInputGraphNode,
          stepExecutionRuntime,
          this.workflowRuntime,
          stepLogger,
          this.connectorExecutor,
          this.dependencies
        );
      case 'waitForApproval':
        return new (
          await import('./wait_for_approval_step/wait_for_approval_step')
        ).WaitForApprovalStepImpl(
          node as WaitForApprovalGraphNode,
          stepExecutionRuntime,
          this.workflowRuntime,
          stepLogger,
          this.connectorExecutor,
          this.dependencies
        );
      case 'atomic':
        return new (await import('./atomic_step/atomic_step_impl')).AtomicStepImpl(
          node as AtomicGraphNode,
          stepExecutionRuntime,
          this.connectorExecutor,
          this.workflowRuntime,
          stepLogger
        );
      case 'workflow.execute':
      case 'workflow.executeAsync':
        if (!this.dependencies.workflowsExecutionEngine) {
          throw new Error('WorkflowsExecutionEngine is not available in dependencies');
        }
        if (!this.dependencies.workflowRepository) {
          throw new Error('WorkflowRepository is not available in dependencies');
        }
        if (!this.dependencies.workflowExecutionRepository) {
          throw new Error('WorkflowExecutionRepository is not available in dependencies');
        }
        if (!this.dependencies.stepExecutionRepository) {
          throw new Error('StepExecutionRepository is not available in dependencies');
        }
        if (!this.dependencies.spaceId) {
          throw new Error('spaceId is not available in dependencies');
        }
        if (!this.dependencies.request) {
          throw new Error('request is not available in dependencies');
        }
        return new (
          await import('./workflow_execute_step/workflow_execute_step_impl')
        ).WorkflowExecuteStepImpl({
          node: node as WorkflowExecuteGraphNode | WorkflowExecuteAsyncGraphNode,
          stepExecutionRuntime,
          workflowExecutionRuntime: this.workflowRuntime,
          workflowRepository: this.dependencies.workflowRepository,
          spaceId: this.dependencies.spaceId,
          request: this.dependencies.request,
          workflowsExecutionEngine: this.dependencies.workflowsExecutionEngine,
          workflowExecutionRepository: this.dependencies.workflowExecutionRepository,
          stepExecutionRepository: this.dependencies.stepExecutionRepository,
          workflowLogger: stepExecutionRuntime.stepLogger,
          config: this.dependencies.config,
        });
      case 'workflow.output':
        this.workflowLogger.logDebug(`Creating workflow.output step`, {
          event: { action: 'workflow-output-step-creation', outcome: 'success' },
          tags: ['step-factory', 'workflow-output', 'core-step'],
        });
        return new (
          await import('./workflow_output_step/workflow_output_step_impl')
        ).WorkflowOutputStepImpl(
          node as WorkflowOutputGraphNode,
          stepExecutionRuntime,
          this.workflowRuntime,
          stepLogger,
          this.stepExecutionRuntimeFactory
        );
      default:
        throw new Error(`Unknown node type: ${node.stepType}`);
    }
  }
}

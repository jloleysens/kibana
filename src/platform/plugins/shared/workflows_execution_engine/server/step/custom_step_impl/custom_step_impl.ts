/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { AtomicGraphNode } from '@kbn/workflows/graph';

import type { CustomStepDefinitionHandler, RuntimeStepDefinition } from './types';
import type { ConnectorExecutor } from '../../connector_executor';
import type { StepExecutionRuntime } from '../../workflow_context_manager/step_execution_runtime';
import type { WorkflowExecutionRuntimeManager } from '../../workflow_context_manager/workflow_execution_runtime_manager';
import type { IWorkflowEventLogger } from '../../workflow_event_logger';
import { toExecutionError } from '../errors';
import { BaseAtomicNodeImplementation } from '../node_implementation';
import type { BaseStep, CancellableNode, RunStepResult } from '../node_implementation';

/**
 * Implementation for custom registered step types.
 *
 * This class executes custom step types registered via the registerStepType API.
 * It validates input against the step's schema, executes the handler function,
 * and validates the output.
 *
 * When the step definition provides an `onCancel` handler, instances expose
 * the `CancellableNode.onCancel` method so the execution engine can invoke
 * cleanup on cancellation.
 */
export class CustomStepImpl
  extends BaseAtomicNodeImplementation<BaseStep>
  implements CancellableNode
{
  private stepHandler: Promise<CustomStepDefinitionHandler> | undefined;

  constructor(
    private node: AtomicGraphNode,
    private stepDefinition: RuntimeStepDefinition,
    stepExecutionRuntime: StepExecutionRuntime,
    connectorExecutor: ConnectorExecutor,
    workflowExecutionRuntime: WorkflowExecutionRuntimeManager,
    private workflowLogger: IWorkflowEventLogger
  ) {
    const baseStep: BaseStep = {
      name: node.stepId,
      stepId: node.stepId,
      type: node.stepType,
      'max-step-size': node.configuration['max-step-size'],
    };
    super(baseStep, stepExecutionRuntime, connectorExecutor, workflowExecutionRuntime);

    if (
      !(
        ('poll' in stepDefinition && typeof stepDefinition.poll === 'function') ||
        ('handler' in stepDefinition && typeof stepDefinition.handler === 'function')
      )
    ) {
      throw new Error('Unknown step definition type provided');
    }
  }

  public async onCancel(): Promise<void> {
    const handler = await this.getStepHandler();
    await handler.onCancel(this.getInput(), this.node.configuration.with, this.getRenderedConfig());
  }

  /**
   * Get and validate the input for this step
   */
  public override getInput(): Record<string, unknown> {
    const withData = this.node.configuration.with || {};
    return this.stepExecutionRuntime.contextManager.renderValueAccordingToContext(withData);
  }

  /**
   * Execute the custom step handler
   */
  protected override async _run(input: unknown): Promise<RunStepResult> {
    try {
      const handler = await this.getStepHandler();
      return await handler.run(input, this.node.configuration.with, this.getRenderedConfig());
    } catch (err) {
      const error = toExecutionError(err as Error).toSerializableObject();
      return { input, output: undefined, error };
    }
  }

  private getRenderedConfig(): Record<string, unknown> {
    const configKeys =
      this.stepDefinition.configKeys ?? Object.keys(this.stepDefinition.configSchema?.shape ?? {});
    if (configKeys.length === 0) return {};

    const config = Object.fromEntries(
      configKeys
        .filter((key) => Object.hasOwn(this.node.configuration, key))
        .map((key) => [key, this.node.configuration[key]])
    );

    return this.stepExecutionRuntime.contextManager.renderValueAccordingToContext(config);
  }

  private getStepHandler(): Promise<CustomStepDefinitionHandler> {
    return (this.stepHandler ??= this.resolveStepHandler());
  }

  private async resolveStepHandler(): Promise<CustomStepDefinitionHandler> {
    if ('poll' in this.stepDefinition && typeof this.stepDefinition.poll === 'function') {
      return new (
        await import('./step_definition_handlers/polling_step_definition_handler')
      ).PollPolicyStepHandler(
        this.stepDefinition,
        this.node,
        this.stepExecutionRuntime,
        this.workflowLogger
      );
    }

    if ('handler' in this.stepDefinition && typeof this.stepDefinition.handler === 'function') {
      return new (
        await import('./step_definition_handlers/one_shot_step_definition_handler')
      ).OneShotStepDefinitionHandler(
        this.stepDefinition,
        this.node,
        this.stepExecutionRuntime,
        this.workflowLogger
      );
    }

    throw new Error(`Unknown step definition type provided`);
  }
}

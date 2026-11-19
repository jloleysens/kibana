/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { createHash } from 'node:crypto';
import type { KibanaRequest, Logger } from '@kbn/core/server';
import { remotable } from '@kbn/core-remote-common';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { getElasticsearchConnectors, getKibanaRequestDefinition } from '@kbn/workflows';
import type { AtomicGraphNode } from '@kbn/workflows/graph';
import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import type {
  WorkflowConnectorInvocation,
  WorkflowStepDescription,
  WorkflowStepInvocation,
  WorkflowStepResult,
  WorkflowStepRunnerApi,
} from './tokens';
import { assertWorkflowRunScope } from './workflow_run_scope';
import { ConnectorExecutor } from '../connector_executor';
import { setupDependencies } from '../execution_functions/setup_dependencies';
import type { StepExecutionRepository } from '../repositories/step_execution_repository';
import type { WorkflowExecutionRepository } from '../repositories/workflow_execution_repository';
import { createBaseHandlerContext } from '../step/custom_step_impl/step_definition_handlers/create_base_handler_context';
import {
  DURABLE_STEP_STATE_KEY,
  type DurableStepState,
} from '../step/custom_step_impl/step_definition_handlers/durable_step_state';
import { toExecutionError } from '../step/errors';
import type { ContextDependencies } from '../workflow_context_manager/types';

type AdditionalTemplateContext = Parameters<
  StepHandlerContext['contextManager']['renderInputTemplate']
>[1];

/** Executes plugin-owned phases with coordinator services and context read from workflow storage. */
@remotable()
export class WorkflowStepRunner implements WorkflowStepRunnerApi {
  private readonly active = new Map<string, AbortController>();
  private readonly esTypes = new Set(getElasticsearchConnectors().map(({ type }) => type));

  constructor(
    private readonly dependencies: ContextDependencies,
    private readonly executions: WorkflowExecutionRepository,
    private readonly steps: StepExecutionRepository,
    private readonly scopes: ScopeLookup,
    private readonly logger: Logger
  ) {}

  /**
   * Describes coordinator-side step types. Types listed in `optional` are natively supported by
   * the worker's own catalog; they are described when the coordinator also knows them and are
   * skipped (not rejected) otherwise, so catalog-only native contributions keep working.
   */
  async describe(
    stepTypes: readonly string[],
    { optional = [] }: { optional?: readonly string[] } = {}
  ): Promise<WorkflowStepDescription[]> {
    await this.dependencies.workflowsExtensions.isReady();
    const optionalTypes = new Set(optional);
    const descriptions: WorkflowStepDescription[] = [];
    for (const type of new Set(stepTypes)) {
      const description = this.describeType(type, optionalTypes.has(type));
      if (description) descriptions.push(description);
    }
    return descriptions;
  }

  private describeType(type: string, optional: boolean): WorkflowStepDescription | undefined {
    const definition = this.dependencies.workflowsExtensions.getStepDefinition(type);
    const [connectorType] = type.split('.', 2);
    const isSpecConnector = this.dependencies.runtimeMetadata.isSpecConnector(connectorType);
    const isActionsConnector = this.dependencies.actions
      .getAllTypes()
      .includes(`.${connectorType}`);
    const mode = definition
      ? 'poll' in definition
        ? 'poll'
        : 'handler'
      : type === 'workflow.execute' ||
        type === 'workflow.executeAsync' ||
        type.startsWith('kibana.')
      ? 'node'
      : this.esTypes.has(type) || type === 'elasticsearch.request'
      ? 'native'
      : type === 'console' || type === 'http' || isSpecConnector || isActionsConnector
      ? 'connector'
      : undefined;
    if (!mode) {
      if (optional) return undefined;
      throw new Error(`Unsupported workflow step type "${type}"`);
    }
    const metadata: Omit<WorkflowStepDescription, 'digest'> = {
      type,
      mode,
      ...(type.startsWith('kibana.') ? { kibana: getKibanaRequestDefinition(type) } : {}),
      ...(mode === 'native'
        ? {
            elasticsearch: this.dependencies.runtimeMetadata.elasticsearchDefinition(type),
          }
        : {}),
      ...(mode === 'connector'
        ? {
            isSpecConnector,
          }
        : {}),
      configKeys: Object.keys(definition?.configSchema?.shape ?? {}),
      hasStart:
        definition !== undefined && 'start' in definition && typeof definition.start === 'function',
      hasOnCancel: typeof definition?.onCancel === 'function',
      ...(definition && 'poll' in definition
        ? { policy: definition.policy, ceilings: definition.ceilings }
        : {}),
    };
    return {
      ...metadata,
      digest: createHash('sha256').update(JSON.stringify(metadata)).digest('hex'),
    };
  }

  stop(): void {
    for (const controller of this.active.values())
      controller.abort(new Error('Workflow runner stopping'));
  }

  async cancel(invocationId: string): Promise<void> {
    this.active.get(invocationId)?.abort(new Error('Workflow step cancelled'));
  }

  async invoke(
    request: WorkflowStepInvocation | WorkflowConnectorInvocation
  ): Promise<WorkflowStepResult | undefined> {
    if (this.active.has(request.invocationId))
      throw new Error('Duplicate workflow step invocation');
    const initialAbort = new AbortController();
    if (request.aborted) initialAbort.abort(new Error('Workflow step cancelled'));
    const scopeSignal = this.scopes.getAbortSignal(request.scopeId);
    const onScopeAbort = () => this.active.get(request.invocationId)?.abort(scopeSignal.reason);
    this.active.set(request.invocationId, initialAbort);
    scopeSignal.addEventListener('abort', onScopeAbort, { once: true });
    if (scopeSignal.aborted) onScopeAbort();
    let prepared: Awaited<ReturnType<typeof setupDependencies>> | undefined;
    try {
      if (request.phase === 'connector') {
        const fakeRequest = this.scopes.get<KibanaRequest>(request.scopeId);
        const client = await this.dependencies.actions.getActionsClientWithRequest(fakeRequest);
        initialAbort.signal.throwIfAborted();
        const executor = new ConnectorExecutor(client);
        const output = await (request.system
          ? executor.executeSystemConnector({
              connectorType: request.connectorType,
              input: request.input,
              abortController: initialAbort,
            })
          : executor.execute({
              connectorType: request.connectorType,
              connectorNameOrId: request.connectorNameOrId,
              input: request.input,
              abortController: initialAbort,
            }));
        return { output };
      }
      assertWorkflowRunScope(this.scopes, request.scopeId, request.executionId, request.spaceId);
      const [description] = await this.describe([request.description.type]);
      if (description.digest !== request.description.digest)
        throw new Error('Workflow step registration changed');
      const definition = this.dependencies.workflowsExtensions.getStepDefinition(description.type);
      if (!definition && description.mode !== 'node')
        throw new Error('Step has no coordinator phase');
      if (
        definition &&
        (('poll' in definition && request.phase === 'handler') ||
          (!('poll' in definition) &&
            request.phase !== 'handler' &&
            request.phase !== 'onCancel') ||
          (request.phase === 'start' && !('start' in definition && definition.start)))
      )
        throw new Error('Workflow step phase mismatch');
      const fakeRequest = this.scopes.get<KibanaRequest>(request.scopeId);
      prepared = await setupDependencies(
        request.executionId,
        request.spaceId,
        this.logger,
        this.dependencies.config,
        this.dependencies,
        this.executions,
        this.steps,
        fakeRequest,
        this.dependencies.workflowsExecutionEngine
      );
      await prepared.stepIoService.load();
      const runtime = prepared.stepExecutionRuntimeFactory.createStepExecutionRuntime({
        nodeId: request.nodeId,
        stackFrames: request.stackFrames,
      });
      if (runtime.node.stepType !== description.type)
        throw new Error('Workflow step reference mismatch');
      if (initialAbort.signal.aborted) runtime.abortController.abort(initialAbort.signal.reason);
      this.active.set(request.invocationId, runtime.abortController);
      if (request.phase !== 'onCancel' && request.phase !== 'nodeCancel')
        runtime.abortController.signal.throwIfAborted();
      await runtime.contextManager.ensureContextReady();
      if (request.phase !== 'onCancel' && request.phase !== 'nodeCancel')
        runtime.abortController.signal.throwIfAborted();
      if (description.mode === 'node') {
        if (request.phase !== 'node' && request.phase !== 'nodeCancel')
          throw new Error('Workflow node phase mismatch');
        const implementation = await prepared.nodesFactory.create(runtime);
        if (request.phase === 'nodeCancel') {
          if ('onCancel' in implementation && typeof implementation.onCancel === 'function')
            await implementation.onCancel();
        } else {
          runtime.abortController.signal.throwIfAborted();
          await implementation.run();
        }
        // Only this step's state/IO is owned here; navigation and workflow persistence stay in worker.
        await prepared.stepIoService.flushStepChanges();
        return;
      }
      if (!definition) throw new Error('Step has no coordinator definition');
      const snapshot = { ...runtime.contextManager.getContext(), now: request.now };
      const node = runtime.node as AtomicGraphNode;
      const input =
        prepared.stepIoService.getStepInput(runtime.stepExecutionId) ??
        runtime.contextManager.renderValueWithContext(node.configuration.with ?? {}, snapshot);
      const config = runtime.contextManager.renderValueWithContext(
        Object.fromEntries(
          description.configKeys
            .filter((key) => Object.hasOwn(node.configuration, key))
            .map((key) => [key, node.configuration[key]])
        ),
        snapshot
      );
      const context = createBaseHandlerContext(
        input,
        node.configuration.with,
        config,
        node,
        runtime,
        runtime.stepLogger
      );
      const handlerContext = {
        ...context,
        contextManager: {
          ...context.contextManager,
          getContext: () => snapshot,
          renderInputTemplate: <T>(value: T, additional?: AdditionalTemplateContext) =>
            runtime.contextManager.renderValueWithContext(value, snapshot, additional),
          renderKqlConditionTemplate: (value: string, additional?: AdditionalTemplateContext) =>
            runtime.contextManager.renderConditionWithContext(value, snapshot, additional),
          createTemplateRenderer:
            () =>
            <T>(value: T, additional?: AdditionalTemplateContext) =>
              runtime.contextManager.renderValueWithContext(value, snapshot, additional),
        },
      };
      const durableState = (runtime.getCurrentStepState()?.[DURABLE_STEP_STATE_KEY] ??
        {}) as DurableStepState;
      const pollContext = {
        ...handlerContext,
        state: durableState.customState,
        attempt: durableState.pollState?.attempt ?? 0,
      };
      if (request.phase === 'onCancel') {
        if ('poll' in definition) await definition.onCancel?.(pollContext);
        else await definition.onCancel?.(handlerContext);
        return;
      }
      runtime.abortController.signal.throwIfAborted();
      const result =
        'poll' in definition
          ? request.phase === 'start'
            ? await definition.start?.(handlerContext)
            : await definition.poll(pollContext)
          : await definition.handler(handlerContext);
      if (result === undefined) return;
      const state = 'state' in result ? result.state : undefined;
      if (
        state !== undefined &&
        (state === null || typeof state !== 'object' || Array.isArray(state))
      ) {
        throw new Error('Coordinator poll returned invalid author state');
      }
      return {
        ...('output' in result ? { output: result.output } : {}),
        ...(state !== undefined ? { state: state as WorkflowStepResult['state'] } : {}),
        ...('nextPollDelayMs' in result && typeof result.nextPollDelayMs === 'number'
          ? { nextPollDelayMs: result.nextPollDelayMs }
          : {}),
        ...(result.error ? { error: toExecutionError(result.error).toSerializableObject() } : {}),
      };
    } finally {
      scopeSignal.removeEventListener('abort', onScopeAbort);
      this.active.delete(request.invocationId);
      await prepared?.eventQueue.flush();
    }
  }
}

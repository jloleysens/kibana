/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { randomUUID } from 'node:crypto';
import type { CoreStart, ElasticsearchClient, KibanaRequest } from '@kbn/core/server';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import {
  type EsWorkflowExecution,
  type EsWorkflowStepExecution,
  type WorkflowYaml,
} from '@kbn/workflows';
import { WorkflowGraph } from '@kbn/workflows/graph';
import type { StepHandlerContext, StepHandlerResult } from '@kbn/workflows-extensions/server';
import { createNativeChildNode } from './native_child_node';
import { noopLogger } from './noop_logger';
import { createRemoteNode } from './remote_node';
import { createRemoteStepDefinition } from './remote_step_definition';
import type {
  WorkflowChildApi,
  WorkflowDispatchFacts,
  WorkflowLogApi,
  WorkflowRunOutcome,
  WorkflowStepCatalogApi,
  WorkflowStepDescription,
  WorkflowStepRunnerApi,
  WorkflowStorageApi,
} from './tokens';
import type { ConnectorExecutor } from '../connector_executor';
import { defaultWorkflowSettings } from '../default_workflow_settings';
import type { LogsRepository } from '../repositories/logs_repository';
import type { StepExecutionRepository } from '../repositories/step_execution_repository';
import type { WorkflowExecutionRepository } from '../repositories/workflow_execution_repository';
import { NodesFactory } from '../step/nodes_factory';
import {
  createPlannedStepDependencyAnalyzer,
  type StepDependencyPlan,
} from '../workflow_context_manager/step_dependency_plan';
import { StepExecutionRuntimeFactory } from '../workflow_context_manager/step_execution_runtime_factory';
import { StepIoService } from '../workflow_context_manager/step_io_service';
import type { ContextDependencies } from '../workflow_context_manager/types';
import { WorkflowExecutionCursor } from '../workflow_context_manager/workflow_execution_cursor';
import { WorkflowExecutionRuntimeManager } from '../workflow_context_manager/workflow_execution_runtime_manager';
import { WorkflowExecutionState } from '../workflow_context_manager/workflow_execution_state';
import { WorkflowRuntimeGraph } from '../workflow_context_manager/workflow_runtime_graph';
import type { IWorkflowEventLogger } from '../workflow_event_logger/types';
import { WorkflowEventLoggerFactory } from '../workflow_event_logger/workflow_event_logger_factory';
import { WorkflowEventQueue } from '../workflow_event_logger/workflow_event_queue';
import { workflowExecutionLoop } from '../workflow_execution_loop/workflow_execution_loop';
import type { WorkflowTaskManager } from '../workflow_task_manager/workflow_task_manager';

interface EngineLoopRequest {
  children?: WorkflowChildApi;
  execution: EsWorkflowExecution;
  dependencyPlan: StepDependencyPlan;
  scopeId: string;
  steps: WorkflowStepCatalogApi;
  storage: WorkflowStorageApi;
  log: WorkflowLogApi;
  resume: boolean;
  signal: AbortSignal;
  esClient?: ElasticsearchClient;
  facts?: WorkflowDispatchFacts;
  remoteSteps?: { runner: WorkflowStepRunnerApi; descriptions: WorkflowStepDescription[] };
}

/**
 * Builds the existing step walker in this isolate and runs it.
 * Plugin start contracts stay on the coordinator. This function calls them through the
 * storage and log capabilities. It does not call `setupDependencies`.
 */
export async function runWorkflowEngineInWorker(
  request: EngineLoopRequest
): Promise<WorkflowRunOutcome> {
  const { execution, scopeId, steps, storage, log } = request;
  recordRemoteTiming('engine_start', { executionId: execution.id, scopeId });
  const compiled = WorkflowGraph.fromWorkflowDefinition(
    execution.workflowDefinition as WorkflowYaml,
    defaultWorkflowSettings
  );
  const workflowExecutionGraph = new WorkflowRuntimeGraph(compiled, execution.scopeStack ?? []);
  const workflowExecutionRepository = executionRepository(scopeId, storage);
  const stepExecutionRepository = stepRepository(scopeId, storage);
  const logger = noopLogger();
  const workflowExecutionState = new WorkflowExecutionState(
    execution,
    workflowExecutionRepository,
    logger
  );
  const stepIoService = new StepIoService({
    dependencyAnalyzer: createPlannedStepDependencyAnalyzer(request.dependencyPlan),
    stepRepository: stepExecutionRepository,
    state: workflowExecutionState,
    // Finite so a later job reloads step outputs from storage. Infinity skips that fetch
    // and assumes the outputs are still in this isolate, which they are not after a pause.
    evictionMinBytes: request.facts?.evictionMinBytes ?? 0,
    logger,
  });
  const eventQueue = new WorkflowEventQueue(logsRepository(log), logger);
  const loggerFactory = new WorkflowEventLoggerFactory(logger, eventQueue, false);
  const workflowLogger = loggerFactory.createExecutionLogger(
    execution.workflowId,
    execution.id,
    execution.workflowDefinition?.name
  );
  const fakeRequest = {} as KibanaRequest;
  const coreStart = {
    http: {
      basePath: {
        publicBaseUrl: request.facts?.kibanaUrl ?? 'http://127.0.0.1:5601',
        serverBasePath: '',
      },
    },
  } as unknown as CoreStart;
  const esClient = request.esClient ?? blockedEsClient();
  const dependencies = contextDependencies({
    coreStart,
    fakeRequest,
    execution,
    steps,
    scopeId,
    stepIoService,
    remoteSteps: request.remoteSteps,
    facts: request.facts,
  });
  const workflowExecutionCursor = new WorkflowExecutionCursor({
    workflowExecutionGraph,
    nodeId: execution.currentNodeId,
    stackFrames: execution.scopeStack ?? [],
  });
  const workflowRuntime = new WorkflowExecutionRuntimeManager({
    workflowExecution: execution,
    workflowExecutionGraph,
    workflowExecutionCursor,
    workflowLogger,
    workflowExecutionState,
    stepIoService,
    coreStart,
    dependencies,
  });
  if (request.remoteSteps) {
    const { runner, descriptions } = request.remoteSteps;
    dependencies.remoteNode = (runtime) => {
      if (
        request.children &&
        (runtime.node.stepType === 'workflow.execute' ||
          runtime.node.stepType === 'workflow.executeAsync')
      ) {
        const maxWorkflowDepth = request.facts?.maxWorkflowDepth;
        if (maxWorkflowDepth === undefined)
          throw new Error('Child execution requires dispatch depth policy');
        return createNativeChildNode({
          children: request.children,
          scopeId,
          runtime,
          workflowRuntime,
          stepIoService,
          maxWorkflowDepth,
        });
      }
      const description = descriptions.find(
        ({ type, mode }) => type === runtime.node.stepType && mode === 'node'
      );
      if (!description) return;
      return createRemoteNode({
        description,
        runner,
        runtime,
        workflowRuntime,
        stepIoService,
        scopeId,
      });
    };
  }
  const stepExecutionRuntimeFactory = new StepExecutionRuntimeFactory({
    workflowExecutionState,
    stepIoService,
    workflowExecutionGraph,
    workflowLogger,
    esClient,
    fakeRequest,
    coreStart,
    dependencies,
  });
  const nodesFactory = new NodesFactory(
    connectorStandIn(scopeId, storage, workflowLogger, steps, request.remoteSteps?.runner),
    workflowRuntime,
    workflowLogger,
    workflowExecutionGraph,
    stepExecutionRuntimeFactory,
    dependencies,
    stepIoService
  );

  if (request.resume) {
    await workflowRuntime.resume();
  } else {
    await workflowRuntime.start();
  }

  await workflowExecutionLoop({
    workflowExecutionGraph,
    workflowRuntime,
    workflowExecutionCursor,
    stepExecutionRuntimeFactory,
    workflowExecutionState,
    stepIoService,
    workflowLogger,
    eventQueue,
    workflowExecutionRepository,
    nodesFactory,
    esClient,
    fakeRequest,
    coreStart,
    signal: request.signal,
    workflowTaskManager: taskManagerStandIn(scopeId, storage, stepIoService),
  });

  return {
    status: workflowRuntime.getWorkflowExecution().status,
    failedStepContext: workflowExecutionState.getLastFailedStepContext(),
  };
}

function executionRepository(
  scopeId: string,
  storage: WorkflowStorageApi
): WorkflowExecutionRepository {
  return {
    updateWorkflowExecution: async (update: Partial<EsWorkflowExecution>) => {
      if (!update.id) {
        throw new Error('Remote execution update is missing an id');
      }
      await storage.updateExecution(
        scopeId,
        update as Partial<EsWorkflowExecution> & { id: string }
      );
    },
    getWorkflowExecutionById: (id: string, spaceId: string) =>
      storage.getExecution(scopeId, id, spaceId),
    getWorkflowExecutionCancelState: (id: string, spaceId: string) =>
      storage.getCancelState(scopeId, id, spaceId),
  } as unknown as WorkflowExecutionRepository;
}

function stepRepository(scopeId: string, storage: WorkflowStorageApi): StepExecutionRepository {
  return {
    bulkUpsert: (steps: Array<Partial<EsWorkflowStepExecution>>) =>
      storage.upsertSteps(scopeId, steps),
    getStepExecutionsByIds: (ids: string[], sourceIncludes?: string[], sourceExcludes?: string[]) =>
      storage.getSteps(scopeId, ids, sourceIncludes, sourceExcludes),
  } as unknown as StepExecutionRepository;
}

function logsRepository(log: WorkflowLogApi): LogsRepository {
  return {
    createLogs: async (events: readonly object[]) => {
      await log.write(events);
    },
  } as unknown as LogsRepository;
}

function taskManagerStandIn(
  scopeId: string,
  storage: WorkflowStorageApi,
  stepIoService: StepIoService
): WorkflowTaskManager {
  const schedule = async (
    execution: EsWorkflowExecution,
    resumeAt: Date,
    kind: Parameters<WorkflowStorageApi['scheduleResume']>[4]
  ) => {
    await stepIoService.flush();
    return storage.scheduleResume(
      scopeId,
      execution.id,
      execution.spaceId,
      resumeAt.toISOString(),
      kind
    );
  };
  return {
    scheduleResumeTask: ({
      workflowExecution,
      resumeAt,
    }: Parameters<WorkflowTaskManager['scheduleResumeTask']>[0]) =>
      schedule(workflowExecution, resumeAt, 'resume'),
    scheduleWorkflowGlobalTimeoutResumeTask: ({
      workflowExecution,
      resumeAt,
    }: Parameters<WorkflowTaskManager['scheduleWorkflowGlobalTimeoutResumeTask']>[0]) =>
      schedule(workflowExecution, resumeAt, 'global_timeout'),
    ensureWakeTask: async ({
      executionId,
      spaceId,
      runAt,
    }: Parameters<WorkflowTaskManager['ensureWakeTask']>[0]) => {
      await stepIoService.flush();
      await storage.scheduleResume(
        scopeId,
        executionId,
        spaceId,
        (runAt ?? new Date()).toISOString(),
        'ensure_wake'
      );
    },
    runExistingResumeTask: async (executionId: string) => {
      await storage.scheduleResume(scopeId, executionId, '', new Date().toISOString(), 'wake');
    },
  } as unknown as WorkflowTaskManager;
}

function connectorStandIn(
  scopeId: string,
  storage: WorkflowStorageApi,
  logger: Pick<IWorkflowEventLogger, 'logWarn'>,
  steps: WorkflowStepCatalogApi,
  runner?: WorkflowStepRunnerApi
): ConnectorExecutor {
  const execute = async (params: Parameters<ConnectorExecutor['execute']>[0], system = false) => {
    const connectorType = params.connectorType.replace(/^\./, '');
    if (steps.supportsConnector(connectorType)) {
      params.abortController.signal.throwIfAborted();
      return steps.runConnector(
        connectorType,
        scopeId,
        {
          connectorType: params.connectorType,
          connectorNameOrId: params.connectorNameOrId,
          input: params.input,
          system,
        },
        { signal: params.abortController.signal }
      );
    }
    if (!runner) return storage.executeConnector(scopeId, { ...params, system });
    params.abortController.signal.throwIfAborted();
    const invocationId = randomUUID();
    const pending = runner.invoke({
      invocationId,
      scopeId,
      phase: 'connector',
      system,
      connectorType: params.connectorType,
      connectorNameOrId: params.connectorNameOrId,
      input: params.input,
      aborted: params.abortController.signal.aborted,
    });
    const onAbort = () => {
      void runner
        .cancel(invocationId)
        .catch(() => logger.logWarn('Remote connector cancellation failed'));
    };
    params.abortController.signal.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await pending;
      return result?.output;
    } finally {
      params.abortController.signal.removeEventListener('abort', onAbort);
    }
  };
  return {
    execute,
    executeSystemConnector: (params: Parameters<ConnectorExecutor['executeSystemConnector']>[0]) =>
      execute({ ...params, connectorNameOrId: `system-connector-${params.connectorType}` }, true),
  } as unknown as ConnectorExecutor;
}

function contextDependencies({
  coreStart,
  fakeRequest,
  execution,
  steps,
  scopeId,
  stepIoService,
  remoteSteps,
  facts,
}: {
  coreStart: CoreStart;
  fakeRequest: KibanaRequest;
  execution: EsWorkflowExecution;
  steps: WorkflowStepCatalogApi;
  scopeId: string;
  stepIoService: StepIoService;
  remoteSteps?: EngineLoopRequest['remoteSteps'];
  facts?: WorkflowDispatchFacts;
}): ContextDependencies {
  const attribution = {
    type: 'workflow',
    id: execution.workflowId,
    name: execution.workflowDefinition?.name ?? '',
    runId: execution.id,
  };
  return {
    runtimeMetadata: {
      elasticsearchDefinition: (type) =>
        remoteSteps?.descriptions.find((item) => item.type === type)?.elasticsearch,
      isSpecConnector: (type) =>
        remoteSteps?.descriptions.find((item) => item.type.split('.', 2)[0] === type)
          ?.isSpecConnector ?? false,
    },
    cloudSetup: undefined,
    coreStart,
    actions: {} as ContextDependencies['actions'],
    taskManager: {} as ContextDependencies['taskManager'],
    ...(remoteSteps
      ? {
          remoteStepDefinition: (stepType, runtime) => {
            const description = remoteSteps.descriptions.find(({ type }) => type === stepType);
            if (!description || (description.mode !== 'handler' && description.mode !== 'poll'))
              return;
            const definition = createRemoteStepDefinition({
              description,
              runner: remoteSteps.runner,
              runtime,
              scopeId,
              flush: () => stepIoService.flush(),
            });
            if (steps.supports(stepType) && 'handler' in definition) {
              return {
                ...definition,
                handler: async (context: StepHandlerContext) =>
                  stepHandlerResult(
                    await steps.run(
                      stepType,
                      scopeId,
                      { with: context.input, config: context.config },
                      { attribution, handlerContext: context }
                    )
                  ),
              };
            }
            return definition;
          },
        }
      : {}),
    workflowsExtensions: {
      hasStepDefinition: (stepType: string) =>
        steps.supports(stepType) ||
        (remoteSteps?.descriptions.some(
          ({ type, mode }) => type === stepType && (mode === 'handler' || mode === 'poll')
        ) ??
          false),
      getStepDefinition: (stepType: string) => ({
        id: stepType,
        handler: async (context: StepHandlerContext) => {
          const result = await steps.run(
            stepType,
            scopeId,
            { with: context.input, config: context.config },
            { attribution, handlerContext: context }
          );
          return stepHandlerResult(result);
        },
      }),
    } as unknown as ContextDependencies['workflowsExtensions'],
    dispatchFacts: facts,
    config: {
      logging: { console: false },
      hitlExternalResume: { enabled: facts?.hitlExternalResumeEnabled ?? false },
    } as ContextDependencies['config'],
    spaceId: execution.spaceId,
    request: fakeRequest,
  };
}

function stepHandlerResult(
  result: Awaited<ReturnType<WorkflowStepCatalogApi['run']>>
): StepHandlerResult {
  if (result && typeof result === 'object') {
    const output = 'output' in result ? result.output : undefined;
    if ('error' in result && result.error instanceof Error) {
      return { output, error: result.error };
    }
    if ('output' in result) return { output };
  }
  return { output: result };
}

function blockedEsClient(): ElasticsearchClient {
  const fail = () => {
    throw new Error('Elasticsearch calls from the worker must go through a coordinator capability');
  };
  return new Proxy(
    {},
    {
      get: () => fail,
    }
  ) as ElasticsearchClient;
}

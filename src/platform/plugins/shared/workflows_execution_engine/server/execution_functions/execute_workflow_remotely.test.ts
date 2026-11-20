/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { httpServerMock, loggingSystemMock } from '@kbn/core/server/mocks';
import { type EsWorkflowExecution, ExecutionStatus } from '@kbn/workflows';
import { executeWorkflowRemotely } from './execute_workflow_remotely';
import { runWorkflowEngineInWorker } from '../remote/assemble_engine_loop';
import type { WorkflowStepCatalogApi, WorkflowStorageApi } from '../remote/tokens';
import { WorkflowExecutor } from '../remote/workflow_executor';
import type { WorkflowExecutionRepository } from '../repositories/workflow_execution_repository';
import type { WorkflowsExecutionEnginePluginStart } from '../types';
import { workflowDefinitionHash } from '../workflow_context_manager/step_dependency_plan';
import type { WorkflowTaskManager } from '../workflow_task_manager/workflow_task_manager';

jest.mock('../remote/assemble_engine_loop', () => ({ runWorkflowEngineInWorker: jest.fn() }));

it.each([
  { throws: false, cleanupThrows: false },
  { throws: true, cleanupThrows: false },
  { throws: true, cleanupThrows: true },
])(
  'runs post-execution once (throws=$throws, cleanupThrows=$cleanupThrows)',
  async ({ throws, cleanupThrows }) => {
    const originalError = new Error('engine exploded');
    const engine = jest.mocked(runWorkflowEngineInWorker);
    if (throws) engine.mockRejectedValueOnce(originalError);
    else engine.mockResolvedValueOnce({ status: ExecutionStatus.COMPLETED });
    let execution = {
      id: 'run-1',
      workflowId: 'workflow-1',
      spaceId: 'default',
      startedAt: new Date().toISOString(),
      status: ExecutionStatus.RUNNING,
      workflowDefinition: { version: '1', name: 'Test', enabled: true, triggers: [], steps: [] },
    } as Partial<EsWorkflowExecution> as EsWorkflowExecution;
    const storage = {
      getExecution: async () => execution,
      complete: jest.fn(async (_scopeId, update) => {
        execution = { ...execution, ...update };
      }),
    } as Partial<WorkflowStorageApi> as WorkflowStorageApi;
    const executor = new WorkflowExecutor({} as WorkflowStepCatalogApi, storage, {
      info: jest.fn(),
      write: jest.fn(),
    });
    const getWorkflowExecutionById = jest.fn(async () => execution);
    if (cleanupThrows) getWorkflowExecutionById.mockRejectedValueOnce(new Error('read failed'));
    const repository = {
      getWorkflowExecutionById,
    } as Partial<WorkflowExecutionRepository> as WorkflowExecutionRepository;
    const removeTasksForExecution = jest.fn().mockResolvedValue(undefined);
    const emitEvent = jest.fn().mockResolvedValue(undefined);
    const dependencyPlan = {
      definitionHash: workflowDefinitionHash(execution.workflowDefinition),
      nodes: {},
      loops: {},
    };
    const running = executeWorkflowRemotely({
      workflowRunId: execution.id,
      spaceId: 'default',
      logger: loggingSystemMock.createLogger(),
      workflowExecutionRepository: repository,
      workflowTaskManager: {
        removeTasksForExecution,
      } as Partial<WorkflowTaskManager> as WorkflowTaskManager,
      workflowsExecutionEngine: {
        triggerEvents: {
          emitEvent,
          isEnabled: true,
          isLogEventsEnabled: false,
          maxEventChainDepth: 10,
          searchTriggerEventLog: jest.fn(),
        },
      } as Partial<WorkflowsExecutionEnginePluginStart> as WorkflowsExecutionEnginePluginStart,
      fakeRequest: httpServerMock.createKibanaRequest(),
      signal: new AbortController().signal,
      dependencyPlan,
      executeRemote: async () => {
        const outcome = await executor.run({
          scopeId: 'scope',
          workflowRunId: execution.id,
          spaceId: 'default',
          dependencyPlan,
        });
        execution = { ...execution, status: outcome.status as ExecutionStatus };
        return outcome;
      },
    });
    if (throws) {
      await expect(running).rejects.toBe(originalError);
      expect(execution.status).toBe(ExecutionStatus.FAILED);
      expect(storage.complete).toHaveBeenCalledTimes(1);
      expect(emitEvent).toHaveBeenCalledTimes(cleanupThrows ? 0 : 1);
    } else {
      await expect(running).resolves.toBeUndefined();
      expect(execution.status).toBe(ExecutionStatus.COMPLETED);
      expect(emitEvent).not.toHaveBeenCalled();
    }
    expect(engine).toHaveBeenCalledTimes(1);
    engine.mockClear();
    expect(removeTasksForExecution).toHaveBeenCalledTimes(1);
    expect(removeTasksForExecution).toHaveBeenCalledWith('run-1', {
      exceptTaskId: 'workflow-wake-run-1',
    });
  }
);

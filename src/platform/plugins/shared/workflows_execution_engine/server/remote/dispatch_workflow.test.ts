/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { coreMock, httpServerMock } from '@kbn/core/server/mocks';
import { loggerMock } from '@kbn/logging-mocks';
import { dispatchWorkflow } from './dispatch_workflow';
import type { WorkflowRunOutcome } from './tokens';
import { WorkflowTaskManagerAbortError } from '../workflow_task_shutdown';

const setup = () => {
  const remote = coreMock.createSetup().remote;
  const lease = {
    stub: {
      run: jest.fn(async (): Promise<WorkflowRunOutcome> => ({ status: 'completed' })),
      cancel: jest.fn(async () => undefined),
    },
    openScope: jest.fn(
      (
        ..._args: Parameters<
          import('@kbn/core-remote-server').RemoteLease<WorkflowRunOutcome>['openScope']
        >
      ) => 'scope-1'
    ),
    closeScope: jest.fn(),
    getScope: jest.fn(),
    release: jest.fn(async () => undefined),
  };
  remote.lease.mockResolvedValue(lease);
  const controller = new AbortController();
  const execution = {
    id: 'run-1',
    spaceId: 'default',
    workflowId: 'workflow-1',
    workflowDefinition: { name: 'Persisted name' },
    stepExecutionIds: [],
  };
  const repositories = {
    workflowExecutionRepository: {
      getWorkflowExecutionById: jest.fn().mockResolvedValue(execution),
    },
    stepExecutionRepository: {
      getStepExecutionsByWorkflowExecution: jest.fn().mockResolvedValue([]),
    },
  };
  const params = {
    repositories,
    remote,
    request: httpServerMock.createKibanaRequest(),
    signal: controller.signal,
    workflowRunId: 'run-1',
    spaceId: 'default',
    facts: { kibanaUrl: 'http://kibana', maxResponseSizeBytes: 1024, evictionMinBytes: 128 },
    logger: loggerMock.create(),
    phase: 'run' as const,
    dependencyPlan: { definitionHash: 'test-hash', nodes: {}, loops: {} },
  };
  return { lease, controller, params };
};

it('leases by non-secret settings and releases all state after success', async () => {
  const { lease, params } = setup();
  expect(await dispatchWorkflow(params)).toEqual({ status: 'completed' });
  expect(params.remote.lease).toHaveBeenCalledWith('workflows', {
    settingsKey: JSON.stringify(params.facts),
    signal: params.signal,
  });
  expect(lease.openScope).toHaveBeenCalledWith(params.request, {
    workflowRunId: 'run-1',
    spaceId: 'default',
    workflowId: 'workflow-1',
    workflowName: 'Persisted name',
    admittedChildren: new Set(),
  });
  expect(lease.closeScope).toHaveBeenCalledWith('scope-1');
  expect(lease.release).toHaveBeenCalledTimes(1);
});

it.each(['open', 'run'] as const)('releases the lease when %s fails', async (failure) => {
  const { lease, params } = setup();
  if (failure === 'open')
    lease.openScope.mockImplementation(() => {
      throw new Error('scope failed');
    });
  else lease.stub.run.mockRejectedValue(new Error('dispatch failed'));
  await expect(dispatchWorkflow(params)).rejects.toThrow('failed');
  expect(lease.release).toHaveBeenCalledTimes(1);
  expect(lease.closeScope).toHaveBeenCalledTimes(failure === 'run' ? 1 : 0);
});

it('forwards Task Manager abort concurrently with an in-flight run', async () => {
  const { lease, controller, params } = setup();
  let reached: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let finish: (outcome: WorkflowRunOutcome) => void = () => {};
  const result = new Promise<WorkflowRunOutcome>((resolve) => {
    finish = resolve;
  });
  lease.stub.run.mockImplementation(async () => {
    reached();
    return result;
  });
  const pending = dispatchWorkflow(params);
  await started;
  controller.abort(new WorkflowTaskManagerAbortError());
  expect(lease.stub.cancel).toHaveBeenCalledWith('scope-1', 'task_manager');
  finish({ status: 'cancelled' });
  expect(await pending).toEqual({ status: 'cancelled' });
  expect(lease.release).toHaveBeenCalledTimes(1);
});

it('restores genuine persisted child admissions on a fresh resume scope, never foreign parents or spaces', async () => {
  const { lease, params } = setup();
  params.repositories.stepExecutionRepository.getStepExecutionsByWorkflowExecution.mockResolvedValue(
    ['genuine', 'foreign-parent', 'foreign-space'].map((id) => ({
      id: `step-${id}`,
      workflowRunId: 'run-1',
      spaceId: 'default',
      state: { executionId: id },
    }))
  );
  const parent = await params.repositories.workflowExecutionRepository.getWorkflowExecutionById();
  params.repositories.workflowExecutionRepository.getWorkflowExecutionById.mockImplementation(
    async (id) =>
      id === 'run-1'
        ? parent
        : {
            id,
            spaceId: id === 'foreign-space' ? 'other' : 'default',
            context: { parentWorkflowExecutionId: id === 'foreign-parent' ? 'other' : 'run-1' },
          }
  );
  await dispatchWorkflow({ ...params, phase: 'resume' });
  expect(lease.openScope.mock.calls[0][1]?.admittedChildren).toEqual(new Set(['genuine']));
});

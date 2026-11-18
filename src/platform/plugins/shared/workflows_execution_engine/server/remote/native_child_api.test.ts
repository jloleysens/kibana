/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { httpServerMock } from '@kbn/core-http-server-mocks';
import { type EsWorkflow, type EsWorkflowExecution, ExecutionStatus } from '@kbn/workflows';
import { NativeChildApi } from './native_child_api';

const setup = () => {
  const request = httpServerMock.createKibanaRequest();
  const controller = new AbortController();
  const parent: EsWorkflowExecution = {
    spaceId: 'space',
    status: ExecutionStatus.RUNNING,
    workflowDefinition: { version: '1', name: 'Parent', enabled: true, triggers: [], steps: [] },
    yaml: '',
    scopeStack: [],
    createdAt: '',
    startedAt: '',
    finishedAt: '',
    duration: 0,
    error: null,
    cancelRequested: false,
    id: 'parent-run',
    workflowId: 'parent',
    managed: true,
    context: { parentDepth: 1 },
    isTestRun: false,
  };
  const workflow = {
    id: 'child',
    enabled: true,
    valid: true,
    name: 'Child',
    yaml: '',
    definition: {},
  } as EsWorkflow;
  const workflows = { getWorkflow: jest.fn(async (): Promise<EsWorkflow | null> => workflow) };
  const executions = {
    getWorkflowExecutionById: jest.fn(async (): Promise<EsWorkflowExecution | null> => parent),
  };
  const steps = { getStepExecutionsByWorkflowExecution: jest.fn(async () => []) };
  const engine = {
    executeWorkflow: jest.fn(async () => ({ workflowExecutionId: 'child-run' })),
    cancelWorkflowExecution: jest.fn(async () => {}),
  };
  const api = new NativeChildApi(
    { get: jest.fn().mockReturnValue(request), getAbortSignal: () => controller.signal },
    workflows,
    executions,
    steps,
    () => engine,
    { maxWorkflowDepth: 10 }
  );
  const childRequest = {
    workflowId: 'child',
    inputs: { answer: 42 },
    stepId: 'invoke',
    invocation: 'sync' as const,
    inheritParentIdentity: true,
  };
  return {
    api,
    controller,
    request,
    parent,
    workflow,
    workflows,
    executions,
    engine,
    childRequest,
  };
};

it('keeps managed visibility, current child definition, run identity and lineage in admission', async () => {
  const { api, request, workflows, engine, childRequest } = setup();
  expect(await api.start('scope', 'parent-run', 'space', childRequest)).toEqual({
    workflowExecutionId: 'child-run',
  });
  expect(workflows.getWorkflow).toHaveBeenCalledWith('child', 'space', {
    includeGlobal: true,
    managedFilter: 'all',
  });
  expect(engine.executeWorkflow).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'child', isTestRun: false, isEphemeral: false }),
    expect.objectContaining({
      parentWorkflowExecutionId: 'parent-run',
      parentWorkflowId: 'parent',
      parentDepth: 2,
      parentStepId: 'invoke',
      inheritParentIdentity: true,
      parentStepName: 'invoke',
      inputs: { answer: 42 },
      spaceId: 'space',
    }),
    request
  );
});

it('refuses child dispatch if its lease ends during preparation', async () => {
  const { api, workflows, workflow, controller, engine, childRequest } = setup();
  workflows.getWorkflow.mockImplementation(async () => {
    controller.abort();
    return workflow;
  });
  await expect(api.start('scope', 'parent-run', 'space', childRequest)).rejects.toHaveProperty(
    'name',
    'AbortError'
  );
  expect(engine.executeWorkflow).not.toHaveBeenCalled();
});

it('refuses a missing parent without dispatching a child', async () => {
  const { api, executions, engine, childRequest } = setup();
  executions.getWorkflowExecutionById.mockResolvedValue(null);
  await expect(api.start('scope', 'parent-run', 'space', childRequest)).rejects.toThrow('Parent');
  expect(engine.executeWorkflow).not.toHaveBeenCalled();
});

it('enforces depth, self-reference and executable-definition guards before scheduling', async () => {
  const { api, parent, workflow, engine, childRequest } = setup();
  parent.context = { parentDepth: 9 };
  await expect(api.start('scope', 'parent-run', 'space', childRequest)).rejects.toThrow(
    'depth limit'
  );
  parent.context = {};
  workflow.id = parent.workflowId;
  await expect(api.start('scope', 'parent-run', 'space', childRequest)).rejects.toThrow('itself');
  workflow.id = 'child';
  workflow.enabled = false;
  await expect(api.start('scope', 'parent-run', 'space', childRequest)).rejects.toThrow(
    'not executable'
  );
  expect(engine.executeWorkflow).not.toHaveBeenCalled();
});

it('cancels through the existing engine with the scoped identity', async () => {
  const { api, engine, request } = setup();
  await api.cancel('scope', 'child-run', 'space');
  expect(engine.cancelWorkflowExecution).toHaveBeenCalledWith('child-run', 'space', request);
});

it('cancels a child whose scheduling finishes after lease teardown', async () => {
  const { api, engine, controller, childRequest, request } = setup();
  engine.executeWorkflow.mockImplementation(async () => {
    controller.abort();
    return { workflowExecutionId: 'late-child' };
  });
  await expect(api.start('scope', 'parent-run', 'space', childRequest)).rejects.toHaveProperty(
    'name',
    'AbortError'
  );
  expect(engine.cancelWorkflowExecution).toHaveBeenCalledWith('late-child', 'space', request);
});

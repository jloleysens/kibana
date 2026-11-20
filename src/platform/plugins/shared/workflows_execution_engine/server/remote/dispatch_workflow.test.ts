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
    workflowDefinition: { name: 'Persisted name', steps: [{ name: 'agent', type: 'ai.agent' }] },
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
    coreStart: coreMock.createStart(),
    request: httpServerMock.createKibanaRequest({ headers: { authorization: 'ApiKey run' } }),
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
    runId: params.workflowRunId,
    signal: params.signal,
  });
  expect(lease.openScope).toHaveBeenCalledWith(
    params.request,
    {
      workflowRunId: 'run-1',
      spaceId: 'default',
      workflowId: 'workflow-1',
      workflowName: 'Persisted name',
      admittedChildren: new Set(),
    },
    new Map([['agent', 1024]]),
    new Map([['agent', 'ai.agent']]),
    { workflowVersion: undefined, metadata: undefined, parent: undefined }
  );
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

it('authors policies from original compiled IDs for global/step fallback, retries, branches, loops and nested workflows', async () => {
  const { WorkflowGraph } = await import('@kbn/workflows/graph');
  const { resolveStepOutputLimit } = await import('../step/resolve_step_output_limit');
  const { defaultWorkflowSettings } = await import('../default_workflow_settings');
  const { lease, params } = setup();
  const authored = {
    version: '1' as const,
    name: 'Compiled policies',
    enabled: true,
    triggers: [{ type: 'manual' as const }],
    settings: {
      'max-step-size': '2kb',
      'on-failure': {
        fallback: [
          {
            name: 'handle_investigation_failure',
            type: 'nightshift.handleInvestigationFailure',
            'max-step-size': '4kb',
            with: { investigation_id: 'run', reason: 'failed' },
          },
        ],
      },
    },
    steps: [
      { name: 'investigate', type: 'ai.agent', with: { message: 'original' } },
      {
        name: 'retried',
        type: 'ai.agent',
        'max-step-size': '8kb',
        with: { message: 'retry' },
        'on-failure': {
          retry: { 'max-attempts': 2 },
          fallback: [{ name: 'step_fallback', type: 'ai.agent', with: { message: 'recover' } }],
        },
      },
      {
        name: 'loop',
        type: 'foreach',
        foreach: '${{ inputs.items }}',
        steps: [
          {
            name: 'condition',
            type: 'if',
            condition: true,
            steps: [{ name: 'nested', type: 'workflow.execute', with: { 'workflow-id': 'child' } }],
            else: [
              {
                name: 'other',
                type: 'ai.agent',
                'max-step-size': '16kb',
                with: { message: 'other' },
              },
            ],
          },
        ],
      },
    ],
  };
  const definition: import('@kbn/workflows').WorkflowYaml = authored;
  params.repositories.workflowExecutionRepository.getWorkflowExecutionById.mockResolvedValue({
    id: 'run-1',
    spaceId: 'default',
    workflowId: 'workflow-1',
    workflowDefinition: definition,
    stepExecutionIds: [],
  });
  await dispatchWorkflow(params);
  const [, , limits, types] = lease.openScope.mock.calls[0];
  const graph = WorkflowGraph.fromWorkflowDefinition(definition, defaultWorkflowSettings);
  for (const node of graph.getAllNodes()) {
    if (
      'configuration' in node &&
      node.configuration &&
      typeof node.configuration === 'object' &&
      'name' in node.configuration &&
      'type' in node.configuration
    ) {
      const configuration = node.configuration as import('@kbn/workflows').BaseStep;
      expect(types?.get(node.stepId)).toBe(node.stepType);
      expect(limits?.get(node.stepId)).toBe(
        resolveStepOutputLimit(
          () => configuration['max-step-size'],
          () => definition.settings?.['max-step-size'],
          () => params.facts.maxResponseSizeBytes
        )
      );
    }
  }
  expect(types?.get('workflow-level-on-failure_investigate_handle_investigation_failure')).toBe(
    'nightshift.handleInvestigationFailure'
  );
  expect(limits?.get('workflow-level-on-failure_investigate_handle_investigation_failure')).toBe(
    4096
  );
  expect(types?.get('step_fallback')).toBe('ai.agent');
  expect(limits?.get('retried')).toBe(8192);
  expect(types?.get('nested')).toBe('workflow.execute');
  expect(limits?.get('other')).toBe(16384);
  expect(types?.has('forged_step')).toBe(false);
  expect(limits?.has('forged_step')).toBe(false);
});

it('captures original persisted provenance and ancestry only in coordinator scope facts', async () => {
  const { lease, params } = setup();
  const execution =
    await params.repositories.workflowExecutionRepository.getWorkflowExecutionById();
  params.repositories.workflowExecutionRepository.getWorkflowExecutionById.mockResolvedValue({
    ...execution,
    version: 7,
    metadata: { ki_verifier_chain: ['trusted'], nested: { value: true } },
    context: {
      metadata: { ki_verifier_chain: ['legacy'] },
      parentWorkflowId: 'parent',
      parentWorkflowExecutionId: 'parent-run',
    },
  });
  await dispatchWorkflow(params);
  expect(lease.openScope.mock.calls[0][4]).toEqual({
    workflowVersion: 7,
    metadata: { ki_verifier_chain: ['trusted'], nested: { value: true } },
    parent: { workflowId: 'parent', executionId: 'parent-run' },
  });
  expect(Object.keys(lease.openScope.mock.calls[0][1] ?? {})).toEqual([
    'workflowRunId',
    'spaceId',
    'workflowId',
    'workflowName',
    'admittedChildren',
  ]);
  for (const field of ['metadata', 'parent', 'workflowVersion']) {
    expect(lease.stub.run.mock.calls[0]).not.toHaveProperty(`0.${field}`);
  }
});

it('stamps scheduled attack-discovery persistence from persisted execution inputs only', async () => {
  const { lease, params } = setup();
  const execution =
    await params.repositories.workflowExecutionRepository.getWorkflowExecutionById();
  params.repositories.workflowExecutionRepository.getWorkflowExecutionById.mockResolvedValue({
    ...execution,
    context: { inputs: { source: 'scheduled', forged: true } },
  });
  await dispatchWorkflow(params);
  expect(lease.openScope.mock.calls[0][4]).toEqual(
    expect.objectContaining({ attackDiscoveryPersistence: 'scheduled' })
  );

  params.repositories.workflowExecutionRepository.getWorkflowExecutionById.mockResolvedValue({
    ...execution,
    context: { inputs: { source: 'manual' } },
  });
  await dispatchWorkflow(params);
  expect(lease.openScope.mock.calls[1][4]).not.toHaveProperty('attackDiscoveryPersistence');
});

it('retains original legacy metadata fallback and omits invalid workflow versions', async () => {
  const { lease, params } = setup();
  const execution =
    await params.repositories.workflowExecutionRepository.getWorkflowExecutionById();
  params.repositories.workflowExecutionRepository.getWorkflowExecutionById.mockResolvedValue({
    ...execution,
    version: 'not-a-document-version',
    context: { metadata: { ki_verifier_chain: ['legacy'] }, parentWorkflowId: 'incomplete' },
  });
  await dispatchWorkflow(params);
  expect(lease.openScope.mock.calls[0][4]).toEqual({
    workflowVersion: undefined,
    metadata: { ki_verifier_chain: ['legacy'] },
    parent: undefined,
  });
});

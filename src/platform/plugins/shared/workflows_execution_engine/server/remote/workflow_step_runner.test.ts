/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { MessageChannel } from 'node:worker_threads';
import { httpServerMock } from '@kbn/core-http-server-mocks';
import { expose, openPortSession } from '@kbn/core-remote-common';
import { loggerMock } from '@kbn/logging-mocks';
import { ExecutionStatus, StepCategory } from '@kbn/workflows';
import type { EsWorkflowExecution, EsWorkflowStepExecution } from '@kbn/workflows';
import type {
  PollHandlerContext,
  ServerHandlerStepDefinition,
  StepHandlerContext,
} from '@kbn/workflows-extensions/server';
import { z } from '@kbn/zod/v4';
import type { WorkflowStepInvocation, WorkflowStepRunnerApi } from './tokens';
import { WorkflowStepRunner } from './workflow_step_runner';
import { mockContextDependencies } from '../execution_functions/__mock__/context_dependencies';
import {
  createMockGetExecutionsByIdsResponse,
  createMockStepDataClient,
  createMockWorkflowDataClient,
} from '../repositories/data_access_layer/mocks';
import { LogsRepository } from '../repositories/logs_repository';
import { StepExecutionRepository } from '../repositories/step_execution_repository';
import { WorkflowExecutionRepository } from '../repositories/workflow_execution_repository';
import { buildStepExecutionId } from '../utils';
import { WorkflowContextManager } from '../workflow_context_manager/workflow_context_manager';

const setup = (handler: ServerHandlerStepDefinition['handler']) => {
  const dependencies = mockContextDependencies();
  const request = httpServerMock.createKibanaRequest({
    headers: { authorization: 'ApiKey scoped' },
  });
  const definition: ServerHandlerStepDefinition = {
    id: 'test.inspect',
    label: 'Inspect',
    description: 'Inspect',
    category: StepCategory.Data,
    inputSchema: z.object({}),
    outputSchema: z.unknown(),
    handler,
  };
  dependencies.workflowsExtensions.getStepDefinition.mockImplementation((type) =>
    type === definition.id ? definition : undefined
  );
  const commonStep = {
    spaceId: 'default',
    workflowRunId: 'run',
    workflowId: 'workflow',
    startedAt: '2026-11-17T00:00:00Z',
    topologicalIndex: 0,
    globalExecutionIndex: 0,
    stepExecutionIndex: 0,
  };
  const docs: EsWorkflowStepExecution[] = [
    {
      ...commonStep,
      id: buildStepExecutionId('run', 'seed', []),
      stepId: 'seed',
      stepType: 'data.set',
      scopeStack: [],
      status: ExecutionStatus.COMPLETED,
      output: { value: 'persisted', large: 'x'.repeat(1_048_576) },
    },
    {
      ...commonStep,
      id: buildStepExecutionId('run', 'target', []),
      stepId: 'target',
      stepType: definition.id,
      scopeStack: [],
      status: ExecutionStatus.RUNNING,
      input: { message: 'rendered by worker' },
    },
  ];
  const execution: EsWorkflowExecution = {
    id: 'run',
    workflowId: 'workflow',
    spaceId: 'default',
    isTestRun: false,
    status: ExecutionStatus.RUNNING,
    context: {},
    yaml: '',
    scopeStack: [],
    createdAt: '2026-11-17T00:00:00Z',
    startedAt: '2026-11-17T00:00:00Z',
    finishedAt: '',
    cancelRequested: false,
    duration: 0,
    error: null,
    stepExecutionIds: docs.map(({ id }) => id),
    workflowDefinition: {
      version: '1',
      name: 'By reference',
      enabled: true,
      triggers: [{ type: 'manual' }],
      steps: [
        { name: 'seed', type: 'data.set', with: { value: 'persisted' } },
        {
          name: 'target',
          type: definition.id,
          with: { message: '${{ steps.seed.output.value }}' },
        },
      ],
    },
  };
  const executions = new WorkflowExecutionRepository(createMockWorkflowDataClient());
  jest.spyOn(executions, 'getWorkflowExecutionById').mockResolvedValue(execution);
  const client = createMockStepDataClient({
    getByIds: jest.fn(async (ids) =>
      createMockGetExecutionsByIdsResponse(docs.filter(({ id }) => ids.includes(id)))
    ),
  });
  const scopeController = new AbortController();
  jest.spyOn(scopeController.signal, 'removeEventListener');
  const runner = new WorkflowStepRunner(
    dependencies,
    executions,
    new StepExecutionRepository(client),
    { get: jest.fn().mockReturnValue(request), getAbortSignal: () => scopeController.signal },
    loggerMock.create()
  );
  const reference = async (): Promise<WorkflowStepInvocation> => ({
    invocationId: 'invocation',
    scopeId: 'scope',
    executionId: 'run',
    spaceId: 'default',
    nodeId: 'target',
    stackFrames: [],
    description: (await runner.describe([definition.id]))[0],
    phase: 'handler',
    now: new Date('2026-11-17T01:02:03Z'),
    aborted: false,
  });
  return {
    runner,
    reference,
    request,
    executions,
    client,
    dependencies,
    docs,
    definition,
    scopeController,
  };
};

beforeEach(() => {
  jest.spyOn(LogsRepository.prototype, 'createLogs').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

it('describes only requested Elasticsearch operations with scalar runtime metadata, never schemas', async () => {
  const { runner } = setup(async () => ({ output: null }));
  const descriptions = await runner.describe(['elasticsearch.search']);
  expect(descriptions).toHaveLength(1);
  const [description] = descriptions;
  expect(description.type).toBe('elasticsearch.search');
  expect(description.mode).toBe('native');
  expect(description.elasticsearch?.methods).toContain('GET');
  expect(description.elasticsearch?.patterns).toContain('{index}/_search');
  expect(Object.keys(description.elasticsearch ?? {}).sort()).toEqual([
    'methods',
    'parameterTypes',
    'patterns',
  ]);
  expect(JSON.parse(JSON.stringify(descriptions))).toEqual(descriptions);
  expect(JSON.stringify(descriptions)).not.toContain('inputSchema');
  expect(JSON.stringify(descriptions)).not.toContain('elasticsearch.bulk');
});

it('rebuilds synchronous context from persisted references without shipping a large prior output', async () => {
  const handler = jest.fn(async (context: StepHandlerContext) => {
    expect(context.input).toEqual({ message: 'rendered by worker' });
    expect(context.rawInput).toEqual({ message: '${{ steps.seed.output.value }}' });
    expect(context.contextManager.renderInputTemplate('${{ steps.seed.output.value }}')).toBe(
      'persisted'
    );
    expect(
      context.contextManager.createTemplateRenderer?.()('${{ steps.seed.output.value }}')
    ).toBe('persisted');
    expect(context.contextManager.getContext().now).toEqual(new Date('2026-11-17T01:02:03Z'));
    context.logger.info('Inspected by reference');
    return { output: { ok: true } };
  });
  const { runner, reference, client, scopeController } = setup(handler);
  const invocation = await reference();
  expect(Buffer.byteLength(JSON.stringify(invocation))).toBeLessThan(2048);
  expect(await runner.invoke(invocation)).toEqual({ output: { ok: true } });
  expect(client.getByIds).toHaveBeenCalled();
  expect(LogsRepository.prototype.createLogs).toHaveBeenCalled();
  expect(handler).toHaveBeenCalledTimes(1);
  expect(scopeController.signal.aborted).toBe(false);
  expect(scopeController.signal.removeEventListener).toHaveBeenCalledWith(
    'abort',
    expect.any(Function)
  );
});

it('cooperatively cancels a pending coordinator phase over a concurrent loopback call', async () => {
  const started = Promise.withResolvers<void>();
  const handler = jest.fn(async (context: StepHandlerContext) => {
    started.resolve();
    await new Promise<void>((resolve) =>
      context.abortSignal.addEventListener('abort', () => resolve(), { once: true })
    );
    return { error: new Error('cancelled by signal') };
  });
  const { runner, reference } = setup(handler);
  const { port1, port2 } = new MessageChannel();
  const stub = openPortSession<WorkflowStepRunnerApi>(port1);
  openPortSession(port2, expose(runner));
  try {
    const pending = stub.invoke(await reference());
    await started.promise;
    await stub.cancel('invocation');
    expect((await pending)?.error?.message).toBe('cancelled by signal');
  } finally {
    runner.stop();
    stub[Symbol.dispose]();
    port1.close();
    port2.close();
  }
});

it('rejects unknown registrations before reading execution data', async () => {
  const { runner, executions } = setup(async () => ({ output: {} }));
  await expect(runner.describe(['not.registered'])).rejects.toThrow('Unsupported workflow step');
  expect(executions.getWorkflowExecutionById).not.toHaveBeenCalled();
});

it('uses persisted durable author state for poll and onCancel without a state snapshot in the DTO', async () => {
  const { runner, reference, dependencies, docs, definition } = setup(async () => ({ output: {} }));
  docs[1].state = {
    __durableStepState: {
      customState: { token: 'persisted' },
      pollState: { attempt: 2, nextPollAt: '2026-11-17T00:00:00Z' },
    },
  };
  const poll = jest.fn(async (context: PollHandlerContext) => {
    expect(context.state).toEqual({ token: 'persisted' });
    expect(context.attempt).toBe(2);
    return { state: { token: 'next' }, nextPollDelayMs: 30 };
  });
  const onCancel = jest.fn(async (context: StepHandlerContext | PollHandlerContext) => {
    expect(context.abortSignal.aborted).toBe(true);
    expect('state' in context).toBe(true);
    if ('state' in context) expect(context.state).toEqual({ token: 'persisted' });
  });
  dependencies.workflowsExtensions.getStepDefinition.mockReturnValue({
    id: definition.id,
    label: definition.label,
    description: definition.description,
    category: definition.category,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    poll,
    onCancel,
  });
  const invocation = await reference();
  expect(await runner.invoke({ ...invocation, phase: 'poll' })).toEqual({
    state: { token: 'next' },
    nextPollDelayMs: 30,
  });
  await runner.invoke({ ...invocation, phase: 'onCancel', aborted: true });
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it('aborts an active coordinator invocation on scope teardown without completing its external effect', async () => {
  const started = Promise.withResolvers<void>();
  const aborted = jest.fn();
  const sideEffect = jest.fn();
  const { runner, reference, scopeController } = setup(async (context) => {
    started.resolve();
    await new Promise<void>((resolve) =>
      context.abortSignal.addEventListener(
        'abort',
        () => {
          aborted();
          resolve();
        },
        { once: true }
      )
    );
    context.abortSignal.throwIfAborted();
    sideEffect();
    return { output: null };
  });
  const pending = runner.invoke(await reference());
  const rejection = expect(pending).rejects.toThrow('Aborted');
  await started.promise;
  scopeController.abort(new Error('Worker disconnected'));
  await rejection;
  expect(aborted).toHaveBeenCalledTimes(1);
  expect(sideEffect).not.toHaveBeenCalled();
  expect(scopeController.signal.removeEventListener).toHaveBeenCalledWith(
    'abort',
    expect.any(Function)
  );
});

it.each(['handler', 'start', 'poll'] as const)(
  'does not enter %s after cancellation during context preparation',
  async (phase) => {
    const handler = jest.fn(async () => ({ output: null }));
    const { runner, reference, dependencies, definition } = setup(handler);
    if (phase !== 'handler')
      dependencies.workflowsExtensions.getStepDefinition.mockReturnValue({
        ...definition,
        start: handler,
        poll: handler,
      });
    const invocation = { ...(await reference()), phase };
    const original = WorkflowContextManager.prototype.ensureContextReady;
    jest
      .spyOn(WorkflowContextManager.prototype, 'ensureContextReady')
      .mockImplementation(async function (this: WorkflowContextManager) {
        await original.call(this);
        await runner.cancel(invocation.invocationId);
      });
    await expect(runner.invoke(invocation)).rejects.toThrow('Aborted');
    expect(handler).not.toHaveBeenCalled();
  }
);

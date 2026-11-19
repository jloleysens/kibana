/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { MessageChannel } from 'node:worker_threads';
import { expose, openPortSession } from '@kbn/core-remote-common';
import { httpServerMock } from '@kbn/core/server/mocks';
import { ExecutionError } from '@kbn/workflows-runtime';
import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import { createConversationNotFoundError } from '@kbn/agent-builder-common';
import { WorkflowAgent } from './workflow_agent';
import type { WorkflowAgentApi } from './workflow_agent_tokens';
import type { RunAgentOperation, WorkflowAgentParams } from './run_agent_types';
import { RunAgentStep } from './run_agent_step';
import { restoreRegistryError } from './registry_errors';
import { createStepHandlerContext } from '../test_utils/workflow_steps';

const params: WorkflowAgentParams = {
  message: 'Message',
  agentId: 'elastic-ai-agent',
  featureIds: [],
  schema: undefined,
  conversationId: undefined,
  authorName: undefined,
  attachments: undefined,
  metadata: undefined,
  configurationOverrides: undefined,
  approvals: undefined,
  templateId: undefined,
  templateVersion: undefined,
  templateVariables: undefined,
  connectorId: undefined,
  createConversation: undefined,
  publicConversation: undefined,
  ephemeral: undefined,
  pluginId: undefined,
  aggregateBy: undefined,
  productSolution: undefined,
  productFeature: undefined,
  maxStepSize: '999999',
  reasoningLevel: undefined,
};
const usage = { inputTokens: 12, outputTokens: 6, cachedTokens: 0, totalTokens: 18 };
const setup = () => {
  const controllers = new Map([
    ['run', new AbortController()],
    ['other', new AbortController()],
  ]);
  const request = httpServerMock.createKibanaRequest();
  const run: jest.MockedFunction<RunAgentOperation> = jest.fn<
    ReturnType<RunAgentOperation>,
    Parameters<RunAgentOperation>
  >(async () => ({
    result: { message: 'Response', conversationId: 'conversation' },
    usage,
  }));
  const scopes = {
    get: jest.fn().mockReturnValue(request),
    getRunState: jest.fn((scope: string) => {
      if (!controllers.has(scope)) throw new Error('Unknown run scope');
      return {
        workflowRunId: `${scope}-trusted`,
        workflowId: 'workflow',
        workflowName: 'Workflow',
        spaceId: 'space',
        admittedChildren: new Set<string>(),
      };
    }),
    resolveStepType: jest.fn((_scope: string, step: string) => {
      if (step === 'unknown') throw new Error('Unknown step definition');
      return step === 'other' ? 'ai.prompt' : 'ai.agent';
    }),
    resolveStepOutputLimit: jest.fn(() => 2048),
    admitChild: jest.fn(),
    getAbortSignal: jest.fn((scope: string) => {
      const controller = controllers.get(scope);
      if (!controller) throw new Error('Unknown run scope');
      return controller.signal;
    }),
  };
  const api = new WorkflowAgent(scopes, run);
  return { api, scopes, run, request, controllers };
};

it('uses the coordinator run/request/limit, not extra worker provenance or limit values', async () => {
  const { api, run, request } = setup();
  const id = await api.runAgent(
    'run',
    'agent',
    Object.assign({}, params, {
      workflowExecutionId: 'forged',
      request: 'forged',
      maxStepSize: '999999999',
    })
  );
  const result = await api.takeResult('run', id);
  expect(result.outcome.usage).toEqual(usage);
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ maxStepSize: '2048' }), {
    request,
    abortSignal: expect.any(AbortSignal),
    workflowExecutionId: 'run-trusted',
    stepId: 'agent',
  });
  expect(run.mock.calls[0][0]).not.toHaveProperty('workflowExecutionId');
  expect(run.mock.calls[0][0]).not.toHaveProperty('request');
  expect(Object.getOwnPropertyNames(Object.getPrototypeOf(expose(api))).sort()).toEqual([
    'cancel',
    'constructor',
    'runAgent',
    'takeResult',
  ]);
});

it('refuses unknown/closed scopes and foreign/non-agent definition steps before running a service', async () => {
  const { api, run, controllers } = setup();
  await expect(api.runAgent('foreign', 'agent', params)).rejects.toThrow('scope');
  await expect(api.runAgent('run', 'unknown', params)).rejects.toThrow('definition');
  await expect(api.runAgent('run', 'other', params)).rejects.toThrow('ai.agent');
  controllers.get('run')?.abort();
  await expect(api.runAgent('run', 'agent', params)).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
});

it('allows repeated, retry, loop and parallel calls within run authority without claiming independent admission', async () => {
  const { api, run } = setup();
  for (let retry = 0; retry < 2; retry++) {
    const ids = await Promise.all(
      Array.from({ length: 3 }, () => api.runAgent('run', 'agent', params))
    );
    expect(new Set(ids).size).toBe(3);
    await Promise.all(ids.map((id) => api.takeResult('run', id)));
  }
  expect(run).toHaveBeenCalledTimes(6);
});

it('keeps results opaque, run-owned and single-use including concurrent consumption', async () => {
  const { api } = setup();
  const id = await api.runAgent('run', 'agent', params);
  await expect(api.takeResult('other', id)).rejects.toThrow('owned');
  await expect(api.cancel('other', id)).rejects.toThrow('owned');
  const first = api.takeResult('run', id);
  await expect(api.takeResult('run', id)).rejects.toThrow();
  await expect(first).resolves.toMatchObject({ outcome: { usage } });
  await expect(api.takeResult('run', id)).rejects.toThrow('owned');
});

it('enforces trusted request and result limits with the original StepSizeLimitExceeded details', async () => {
  const { api, scopes, run } = setup();
  scopes.resolveStepOutputLimit.mockReturnValueOnce(16);
  const requestRef = await api.runAgent('run', 'agent', params);
  expect(await api.takeResult('run', requestRef)).toMatchObject({
    sizeError: { type: 'StepSizeLimitExceeded', details: { limitBytes: 16 } },
  });
  expect(run).not.toHaveBeenCalled();
  run.mockResolvedValueOnce({ result: { message: 'x'.repeat(3000) }, usage });
  const resultRef = await api.runAgent('run', 'agent', params);
  const result = await api.takeResult('run', resultRef);
  expect(result).toMatchObject({
    sizeError: { type: 'StepSizeLimitExceeded', details: { limitBytes: 2048 } },
  });
  expect(JSON.stringify(result)).not.toContain('x'.repeat(3000));
});

it('preserves deliberate zero disabling rather than inventing a fixed numeric cap', async () => {
  const { api, scopes, run } = setup();
  scopes.resolveStepOutputLimit.mockReturnValue(0);
  run.mockResolvedValueOnce({ result: { message: 'x'.repeat(3000) }, usage });
  const id = await api.runAgent('run', 'agent', params);
  expect(await api.takeResult('run', id)).not.toHaveProperty('sizeError');
  expect(run.mock.calls[0][0].maxStepSize).toBeUndefined();
});

it.each(['scope', 'step'] as const)(
  'cancels original service work on %s abort and prevents late successful results',
  async (kind) => {
    const { api, run, controllers } = setup();
    let signal: AbortSignal | undefined;
    run.mockImplementationOnce(async (_params, context) => {
      signal = context.abortSignal;
      await new Promise<void>((resolve) =>
        context.abortSignal.addEventListener('abort', () => resolve(), { once: true })
      );
      return { result: { message: 'late' }, usage };
    });
    const id = await api.runAgent('run', 'agent', params);
    const pending = api.takeResult('run', id);
    if (kind === 'scope') controllers.get('run')?.abort();
    else await api.cancel('run', id);
    expect(signal?.aborted).toBe(true);
    if (kind === 'scope') await expect(pending).rejects.toThrow();
    else expect(await pending).toMatchObject({ outcome: { error: expect.any(Error) } });
    await expect(api.takeResult('run', id)).rejects.toThrow();
  }
);

it('restores original typed errors and partial usage across actual serialized RPC without private properties', async () => {
  const { api, run } = setup();
  const denied = Object.assign(createConversationNotFoundError({ conversationId: 'foreign' }), {
    headers: { authorization: 'private-secret' },
  });
  run.mockResolvedValueOnce({ usage, error: denied });
  const { port1, port2 } = new MessageChannel();
  try {
    const remote = openPortSession<WorkflowAgentApi>(port1);
    openPortSession(port2, expose(api));
    const id = await remote.runAgent('run', 'agent', params);
    const { outcome } = await remote.takeResult('run', id);
    expect(outcome.usage).toEqual(usage);
    expect(JSON.stringify(outcome)).not.toContain('private-secret');
    await expect(restoreRegistryError(Promise.reject(outcome.error))).rejects.toBeInstanceOf(
      denied.constructor
    );
    await expect(remote.takeResult('run', id)).rejects.toThrow('owned');
  } finally {
    port1.close();
    port2.close();
  }
});

it('runs original normalization/output projection worker-local and restores size errors before engine persistence', async () => {
  const { api, scopes, run } = setup();
  const step = new RunAgentStep(api);
  const context = createStepHandlerContext({
    input: { message: 'Message', author_name: '  Name  ' },
  });
  context.contextManager = {
    ...context.contextManager,
    getContext: jest.fn().mockReturnValue({ execution: { id: 'worker-forged' } }),
  } as StepHandlerContext['contextManager'];
  const result = await step.run('run', {}, { handlerContext: context });
  expect(result).toEqual({
    output: {
      message: 'Response',
      conversation_id: 'conversation',
      structured_output: undefined,
      metadata: { usage },
    },
  });
  expect(run.mock.calls[0][0].authorName).toBe('Name');
  scopes.resolveStepOutputLimit.mockReturnValueOnce(1);
  const failed = await step.run('run', {}, { handlerContext: context });
  expect(failed).toMatchObject({ error: expect.any(ExecutionError) });
  expect(ExecutionError.fromError((failed as { error: Error }).error).type).toBe(
    'StepSizeLimitExceeded'
  );
});

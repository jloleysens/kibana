/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { MessageChannel } from 'node:worker_threads';
import { expose, openPortSession } from '@kbn/core-remote-common';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { httpServerMock } from '@kbn/core-http-server-mocks';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import { Reinforcement } from './reinforcement';
import type { ReinforcementApi, ReinforcementInput } from './reinforcement_tokens';
import { KibanaApiCallError } from '@kbn/workflows-runtime';
import { toExecutionError } from '@kbn/workflows-execution-engine/server/step/errors';
import { restoreReinforcementError } from './reinforcement_errors';
import { restoreInvestigationError } from './investigation_errors';
import {
  buildInvestigationConversation,
  buildInvestigationRound,
} from '../decision_trees/investigation_round';
import { NIGHTSHIFT_DECISION_TREE_REINFORCEMENT_AGENT_ID } from '../../common/agent_ids';

const input: ReinforcementInput = {
  defaultConnectorId: 'model',
  conversation: buildInvestigationConversation({
    conversationId: 'fresh',
    agentId: NIGHTSHIFT_DECISION_TREE_REINFORCEMENT_AGENT_ID,
    now: 'now',
    round: buildInvestigationRound({
      roundId: 'round',
      prompt: 'prompt',
      response: 'response',
      toolCalls: [],
      startedAt: 'now',
    }),
  }),
  message: 'Reinforce',
  includeLearningTools: false,
};
const setup = () => {
  const controller = new AbortController();
  const other = new AbortController();
  const request = httpServerMock.createKibanaRequest();
  const scopes: ScopeLookup = {
    get: jest.fn().mockReturnValue(request),
    getRunState: jest
      .fn()
      .mockReturnValue({ workflowRunId: 'execution', workflowId: 'workflow', spaceId: 'ops' }),
    getAbortSignal: (id) => {
      if (id === 'run') return controller.signal;
      if (id === 'other') return other.signal;
      throw new Error('Foreign scope');
    },
    resolveStepType: jest.fn().mockReturnValue('nightshift.decisionTreeReinforce'),
    resolveStepOutputLimit: jest.fn().mockReturnValue(1024),
    admitChild: jest.fn(),
  };
  const runAgent = jest
    .fn()
    .mockResolvedValue({ result: { round: { response: { message: 'Reinforced' } } } });
  const getAgentBuilder = () => ({ agents: { runAgent } } as unknown as AgentBuilderPluginStart);
  return {
    api: new Reinforcement(scopes, getAgentBuilder, () => true),
    controller,
    scopes,
    runAgent,
    request,
  };
};

it('runs the original fixed agent with trusted request/provenance and single-use run-owned results', async () => {
  const { api, runAgent, request } = setup();
  expect(await api.read('run')).toEqual({ enabled: true, available: true });
  const reference = await api.begin('run', 'step', {
    ...input,
    request: 'forged',
    telemetryMetadata: { interactionId: 'foreign' },
    agentId: 'foreign',
  } as ReinforcementInput);
  await expect(api.take('other', reference)).rejects.toThrow('not owned');
  expect(await api.take('run', reference)).toEqual({ message: 'Reinforced' });
  await expect(api.take('run', reference)).rejects.toThrow('not owned');
  expect(runAgent).toHaveBeenCalledWith({
    request,
    agentId: NIGHTSHIFT_DECISION_TREE_REINFORCEMENT_AGENT_ID,
    interactive: { enabled: false },
    defaultConnectorId: 'model',
    abortSignal: expect.any(AbortSignal),
    agentParams: {
      conversation: expect.objectContaining({ ...input.conversation, id: expect.any(String) }),
      nextInput: { message: 'Reinforce' },
    },
    telemetryMetadata: {
      pluginId: 'nightshift_investigation_memory',
      aggregateBy: 'nightshift',
      productSolution: 'observability',
      productFeature: 'nightshift',
      interactionId: 'execution',
    },
  });
  expect(
    Object.getOwnPropertyNames(Object.getPrototypeOf(expose(api)))
      .filter((name) => name !== 'constructor')
      .sort()
  ).toEqual(['begin', 'cancel', 'read', 'take']);
});

it('refuses foreign/closed scopes and wrong persisted step types before invoking the runtime', async () => {
  const { api, controller, scopes, runAgent } = setup();
  await expect(api.read('foreign')).rejects.toThrow('Foreign');
  jest.mocked(scopes.resolveStepType).mockReturnValue('ai.agent');
  await expect(api.begin('run', 'step', input)).rejects.toThrow('not a scoped');
  controller.abort();
  await expect(api.begin('run', 'step', input)).rejects.toThrow();
  expect(runAgent).not.toHaveBeenCalled();
});

it('resolves output limits on the coordinator rather than trusting worker policy', async () => {
  const { api, scopes } = setup();
  jest.mocked(scopes.resolveStepOutputLimit).mockReturnValue(1);
  const reference = await api.begin('run', 'step', input);
  expect(await api.take('run', reference)).toEqual({
    sizeError: expect.objectContaining({ type: 'StepSizeLimitExceeded' }),
  });
  expect(scopes.resolveStepOutputLimit).toHaveBeenCalledWith('run', 'step');
});

it.each(['cancel', 'close'] as const)(
  'propagates %s to the original agent signal',
  async (action) => {
    const { api, controller, runAgent } = setup();
    runAgent.mockImplementation(
      ({ abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise((resolve) => {
          abortSignal.addEventListener(
            'abort',
            () => resolve({ result: { round: { response: { message: 'late' } } } }),
            { once: true }
          );
        })
    );
    const reference = await api.begin('run', 'step', input);
    const result = api.take('run', reference);
    if (action === 'close') controller.abort();
    else await api.cancel('run', reference);
    if (action === 'close') await expect(result).rejects.toThrow();
    else expect(await result).toEqual({ error: expect.any(Error) });
    expect(runAgent.mock.calls[0][0].abortSignal.aborted).toBe(true);
  }
);

it('preserves original error names/types over serialized RPC without leaking private runtime metadata', async () => {
  const { api, runAgent } = setup();
  runAgent.mockRejectedValue(
    Object.assign(new TypeError('Original denial'), {
      name: 'AgentDenied',
      headers: { authorization: 'private-runtime' },
    })
  );
  const { port1, port2 } = new MessageChannel();
  try {
    const remote = openPortSession<ReinforcementApi>(port1);
    openPortSession(port2, expose(api));
    const reference = await remote.begin('run', 'step', input);
    const result = await remote.take('run', reference);
    expect(JSON.stringify(result)).not.toContain('private-runtime');
    await expect(restoreInvestigationError(Promise.reject(result.error))).rejects.toMatchObject({
      name: 'AgentDenied',
      message: 'Original denial',
      constructor: TypeError,
    });
  } finally {
    port1.close();
    port2.close();
  }
});

it('preserves the original persisted HTTP status projection without transporting response body or headers', async () => {
  const { api, runAgent } = setup();
  const original = new KibanaApiCallError({
    status: 403,
    message: 'HTTP 403: Original denial',
    headers: { authorization: 'private-http' },
    body: { private: 'private-http' },
  });
  runAgent.mockRejectedValueOnce(original);
  const { port1, port2 } = new MessageChannel();
  try {
    const remote = openPortSession<ReinforcementApi>(port1);
    openPortSession(port2, expose(api));
    const reference = await remote.begin('run', 'step', input);
    const result = await remote.take('run', reference);
    expect(JSON.stringify(result)).not.toContain('private-http');
    try {
      await restoreReinforcementError(Promise.reject(result.error));
      throw new Error('Expected denial');
    } catch (error) {
      expect(toExecutionError(error).toSerializableObject()).toEqual(
        toExecutionError(original).toSerializableObject()
      );
    }
  } finally {
    port1.close();
    port2.close();
  }
});

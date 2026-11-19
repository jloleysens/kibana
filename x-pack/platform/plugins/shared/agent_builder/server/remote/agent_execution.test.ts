/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { MessageChannel } from 'node:worker_threads';
import { EMPTY } from 'rxjs';
import { expose, openPortSession } from '@kbn/core-remote-common';
import { httpServerMock } from '@kbn/core/server/mocks';
import {
  AgentExecutionMode,
  ChatTriggerMode,
  createConversationNotFoundError,
} from '@kbn/agent-builder-common';
import { AgentExecution } from './agent_execution';
import type { AgentExecutionApi } from './agent_execution_tokens';
import { AddUserMessageStep } from './add_user_message_step';
import { restoreRegistryError } from './registry_errors';
import { createStepHandlerContext } from '../test_utils/workflow_steps';

const setup = () => {
  const controller = new AbortController();
  const request = httpServerMock.createKibanaRequest();
  const maybeExecuteAgent = jest.fn(async () => ({
    conversationId: 'conversation',
    events$: EMPTY,
  }));
  const service = { maybeExecuteAgent };
  const getService = jest.fn(() => service);
  const api = new AgentExecution(
    {
      get: jest.fn().mockImplementation((scopeId) => {
        if (scopeId !== 'run') throw new Error('Foreign run');
        return request;
      }),
      getRunState: jest.fn(),
      resolveStepType: jest.fn(),
      resolveStepOutputLimit: jest.fn(),
      admitChild: jest.fn(),
      getAbortSignal: (scopeId) => {
        if (scopeId !== 'run') throw new Error('Foreign run');
        return controller.signal;
      },
    },
    getService
  );
  return { api, controller, request, maybeExecuteAgent, getService };
};

it('binds the original never-trigger service operation to the coordinator request, never an LLM or whole handler', async () => {
  const { api, request, maybeExecuteAgent } = setup();
  await expect(
    api.appendUserMessage('run', 'conversation', 'Message', 'Display name')
  ).resolves.toBeUndefined();
  expect(maybeExecuteAgent).toHaveBeenCalledWith({
    mode: AgentExecutionMode.conversation,
    request,
    params: {
      conversationId: 'conversation',
      nextInput: { message: 'Message' },
      triggerMode: ChatTriggerMode.Never,
      author: { full_name: 'Display name' },
    },
  });
  expect('executeAgent' in expose(api)).toBe(false);
  expect('invoke' in expose(api)).toBe(false);
});

it('refuses foreign and closed scopes before acquiring the original service', async () => {
  const { api, controller, getService } = setup();
  await expect(api.appendUserMessage('foreign', 'conversation', 'Message')).rejects.toThrow(
    'Foreign run'
  );
  controller.abort();
  await expect(api.appendUserMessage('run', 'conversation', 'Message')).rejects.toThrow();
  expect(getService).not.toHaveBeenCalled();
});

it('preserves the original scoped conversation denial without private error metadata over serialized RPC', async () => {
  const { api, maybeExecuteAgent } = setup();
  const denied = Object.assign(createConversationNotFoundError({ conversationId: 'foreign' }), {
    headers: { authorization: 'fake-private-authorization' },
  });
  maybeExecuteAgent.mockRejectedValueOnce(denied);
  const { port1, port2 } = new MessageChannel();
  try {
    const remote = openPortSession<AgentExecutionApi>(port1);
    openPortSession(port2, expose(api));
    try {
      await restoreRegistryError(remote.appendUserMessage('run', 'foreign', 'Message'));
      throw new Error('Expected original denial');
    } catch (error) {
      expect(error).toBeInstanceOf(denied.constructor);
      expect(error).toMatchObject({ code: 'conversationNotFound' });
      expect(JSON.stringify(error)).not.toContain('fake-private-authorization');
      expect(error).not.toHaveProperty('headers');
    }
    expect(denied.headers.authorization).toBe('fake-private-authorization');
  } finally {
    port1.close();
    port2.close();
  }
});

it('executes the original message handler locally and retains original name normalization and output', async () => {
  const appendUserMessage = jest.fn(async () => {});
  const step = new AddUserMessageStep({ appendUserMessage });
  const result = await step.run(
    'run',
    {},
    {
      handlerContext: createStepHandlerContext({
        input: {
          conversation_id: 'conversation',
          message: 'Message',
          author_name: '  Display name  ',
        },
      }),
    }
  );
  expect(result).toEqual({ output: { conversation_id: 'conversation' } });
  expect(appendUserMessage).toHaveBeenCalledWith('run', 'conversation', 'Message', 'Display name');
});

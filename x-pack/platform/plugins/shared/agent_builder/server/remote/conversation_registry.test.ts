/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createAgentNotFoundError } from '@kbn/agent-builder-common';
import { MessageChannel } from 'node:worker_threads';
import { expose, openPortSession } from '@kbn/core-remote-common';
import { elasticsearchServiceMock, httpServerMock } from '@kbn/core/server/mocks';
import { loggerMock } from '@kbn/logging-mocks';
import { z } from '@kbn/zod/v4';
import { createConversationEventsService } from '../services/conversation_events/conversation_events_service';
import { validateConversationEvents } from '../services/conversation_events/validation';
import { ConversationRegistry } from './conversation_registry';
import type { ConversationRegistryApi } from './conversation_tokens';
import { createNativeConversation } from './native_conversation';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { remoteModule } from '.';

const setup = () => {
  const controller = new AbortController();
  const request = httpServerMock.createKibanaRequest();
  const events = createConversationEventsService();
  events.setup().register({
    type: 'text_note',
    payloadSchema: z.object({ text: z.string().min(1).max(1000) }),
    format: () => ({ type: 'text', value: 'Note' }),
  });
  const conversationEvents = events.start();
  const esClient = elasticsearchServiceMock.createElasticsearchClient();
  const { get, index } = esClient;
  const agentGet = jest.fn(async () => {});
  const getIds = jest.fn(async () => ['agent']);
  const user = { id: 'owner', username: 'owner', isAdmin: false };
  const options = {
    user,
    space: 'default',
    logger: loggerMock.create(),
    esClient,
    agentRegistry: { get: agentGet, getIds },
    conversationEvents,
  };
  const getOptions = jest.fn(async () => options);
  const api = new ConversationRegistry(
    {
      get: jest.fn().mockImplementation((id: string) => {
        if (id !== 'run') throw new Error('Foreign scope');
        return request;
      }),
      getRunState: jest.fn(),
      resolveStepType: jest.fn(),
      resolveStepOutputLimit: jest.fn(),
      admitChild: jest.fn(),
      getAbortSignal: (id) => {
        if (id !== 'run') throw new Error('Foreign scope');
        return controller.signal;
      },
    },
    getOptions
  );
  return {
    api,
    controller,
    request,
    user,
    agentGet,
    getIds,
    getOptions,
    esClient,
    get,
    index,
    conversationEvents,
  };
};

it('borrows only the owning original service options and exports identity facts, never live clients', async () => {
  const { api, request, user, getOptions, agentGet } = setup();
  const policy = await api.read('run');
  policy.user.username = 'mutated';
  expect(user.username).toBe('owner');
  expect(Object.keys(policy).sort()).toEqual([
    'clientLeaseId',
    'emitsEvents',
    'logging',
    'reportsCreation',
    'reportsFieldChanges',
    'space',
    'templates',
    'user',
  ]);
  await api.assertAgentUse('run', policy.clientLeaseId, 'agent');
  expect(agentGet).toHaveBeenCalledWith('agent', { access: 'use' });
  expect(getOptions).toHaveBeenCalledTimes(1);
  expect(getOptions).toHaveBeenCalledWith(request);
  expect('call' in expose(api)).toBe(false);
  await expect(api.read('foreign')).rejects.toThrow('Foreign scope');
});

it('refuses a policy response when the scope closes during original identity resolution', async () => {
  const { api, controller, getOptions } = setup();
  const original = await getOptions();
  getOptions.mockImplementationOnce(async () => {
    controller.abort();
    return original;
  });
  await expect(api.read('run')).rejects.toThrow();
});

it.each([
  { type: 'unknown', data: {} },
  { type: 'conversation_created', data: {} },
  { type: 'text_note', data: { text: '' } },
])(
  'preserves original $type rejection across actual RPC before any OCC read/write',
  async (event) => {
    const { api, esClient, get, index, conversationEvents } = setup();
    let expected: { name: string; message: string } | undefined;
    try {
      validateConversationEvents([event], conversationEvents);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      expected = { name: error.name, message: error.message };
    }
    if (!expected) throw new Error('Original validator unexpectedly accepted the invalid event');
    const { port1, port2 } = new MessageChannel();
    try {
      const remote = openPortSession<ConversationRegistryApi>(port1);
      openPortSession(port2, expose(api));
      const { client } = await createNativeConversation({
        registry: remote,
        scopeId: 'run',
        esClient,
        logger: loggerMock.create(),
      });
      await expect(
        client.addCustomEvents({ id: 'conversation', events: [event] }, { source: 'workflow' })
      ).rejects.toMatchObject(expected);
      expect(get).not.toHaveBeenCalled();
      expect(index).not.toHaveBeenCalled();
    } finally {
      port1.close();
      port2.close();
    }
  }
);

it('uses the original live validator and refuses closed scopes', async () => {
  const { api, controller } = setup();
  const policy = await api.read('run');
  await expect(
    api.validateEvents('run', policy.clientLeaseId, [
      { type: 'text_note', data: { text: 'Valid' } },
    ])
  ).resolves.toEqual([{ type: 'text_note', data: { text: 'Valid' } }]);
  controller.abort();
  await expect(api.validateEvents('run', policy.clientLeaseId, [])).rejects.toThrow();
});

it('preserves AgentBuilder error constructors across RPC so original agent-denial masking still applies', async () => {
  const { api, esClient, agentGet, get } = setup();
  agentGet.mockRejectedValueOnce(createAgentNotFoundError({ agentId: 'agent' }));
  get.mockResolvedValueOnce({
    _id: 'conversation',
    _index: '.chat-conversations-000001',
    _seq_no: 1,
    _primary_term: 1,
    found: true,
    _source: {
      user_id: 'owner',
      user_name: 'owner',
      user_type: 'user',
      agent_id: 'agent',
      space: 'default',
      title: 'Private',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      conversation_rounds: [],
      schema_version: 1,
      events: [],
      access_control: { access_mode: 'private', entries: [] },
    },
  });
  const { port1, port2 } = new MessageChannel();
  try {
    const remote = openPortSession<ConversationRegistryApi>(port1);
    openPortSession(port2, expose(api));
    const { client } = await createNativeConversation({
      registry: remote,
      scopeId: 'run',
      esClient,
      logger: loggerMock.create(),
    });
    await expect(client.get('conversation')).rejects.toMatchObject({
      code: 'conversationNotFound',
    });
  } finally {
    port1.close();
    port2.close();
  }
});

it('does not export private request metadata and preserves non-AgentBuilder builtin errors', async () => {
  const { api, getOptions, esClient } = setup();
  const original = Object.assign(new TypeError('Original identity failure'), {
    meta: { request: { headers: { authorization: 'fake-private-authorization' } } },
  });
  getOptions.mockRejectedValueOnce(original);
  const { port1, port2 } = new MessageChannel();
  try {
    const remote = openPortSession<ConversationRegistryApi>(port1);
    openPortSession(port2, expose(api));
    try {
      await createNativeConversation({
        registry: remote,
        scopeId: 'run',
        esClient,
        logger: loggerMock.create(),
      });
      throw new Error('Expected identity failure');
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect(error).toMatchObject({ name: 'TypeError', message: 'Original identity failure' });
      expect(JSON.stringify(error)).not.toMatch(/authorization|fake-private|headers|request/);
    }
    expect(original.meta.request.headers.authorization).toBe('fake-private-authorization');
  } finally {
    port1.close();
    port2.close();
  }
});

it('does not poison a run after transient original identity resolution fails', async () => {
  const { api, getOptions } = setup();
  getOptions.mockRejectedValueOnce(new Error('Transient original identity failure'));
  await expect(api.read('run')).rejects.toThrow('Transient original identity failure');
  await expect(api.read('run')).resolves.toMatchObject({ space: 'default', user: { id: 'owner' } });
  expect(getOptions).toHaveBeenCalledTimes(2);
});

it.each(remoteModule.contributions ?? [])(
  '$stepType refuses missing executor context before acquiring identity',
  async ({ modulePath, exportName }) => {
    const { api, esClient, getOptions } = setup();
    const Constructor =
      jest.requireActual<
        Record<
          string,
          new (
            registry: ConversationRegistryApi,
            data: { internal(): typeof esClient }
          ) => RemoteWorkflowStep
        >
      >(modulePath)[exportName];
    await expect(
      new Constructor(api, { internal: () => esClient }).run('run', {}, {})
    ).rejects.toThrow('executor-local handler context');
    expect(getOptions).not.toHaveBeenCalled();
  }
);

it('batches original notification hooks and preserves their best-effort independence', async () => {
  const { api, getOptions, get } = setup();
  const original = await getOptions();
  get.mockRejectedValueOnce({ statusCode: 404 });
  get.mockResolvedValue({
    _id: 'conversation',
    _index: '.chat-conversations-000001',
    _seq_no: 10,
    _primary_term: 1,
    _version: 1,
    found: true,
    _source: {
      user_id: 'owner',
      user_name: 'owner',
      agent_id: 'agent',
      space: 'default',
      title: 'Created',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      conversation_rounds: [],
      events: [],
      schema_version: 1,
    },
  });
  const created = jest.fn(() => {
    throw new Error('Original audit hook failed');
  });
  const patched = jest.fn();
  getOptions.mockImplementationOnce(async () => ({
    ...original,
    onConversationCreated: created,
    eventEmitter: {
      emitMetadataPatched: jest.fn(),
      emitAttachmentEvents: jest.fn(),
      emitConversationUpdated: patched,
    },
  }));
  const policy = await api.read('run');
  const { writeLeaseId } = await api.prepareWrite('run', policy.clientLeaseId, 'conversation');
  await expect(
    api.notify('run', policy.clientLeaseId, [
      { operation: 'created', conversationId: 'conversation', writeLeaseId },
      { operation: 'emitConversationUpdated', conversationId: 'conversation', writeLeaseId },
    ])
  ).resolves.toBeUndefined();
  expect(created).toHaveBeenCalledTimes(1);
  expect(patched).toHaveBeenCalledWith(
    expect.objectContaining({
      conversationId: 'conversation',
      source: 'workflow',
      changeKinds: ['created', 'title'],
    })
  );
  expect(original.logger.warn).toHaveBeenCalled();
});

it('reauthenticates each client, isolates parallel identity snapshots, and releases read-only references', async () => {
  const { api, getOptions, agentGet, getIds } = setup();
  const original = await getOptions();
  const secondGet = jest.fn(async () => {});
  getOptions.mockClear();
  getOptions.mockResolvedValueOnce({ ...original, user: { ...original.user, id: 'first' } });
  getOptions.mockResolvedValueOnce({
    ...original,
    user: { ...original.user, id: 'second' },
    agentRegistry: { get: secondGet, getIds },
  });
  const first = await api.read('run');
  const second = await api.read('run');
  expect(first.clientLeaseId).not.toBe(second.clientLeaseId);
  expect(first.user.id).toBe('first');
  expect(second.user.id).toBe('second');
  await api.assertAgentUse('run', first.clientLeaseId, 'agent');
  expect(agentGet).toHaveBeenCalledTimes(1);
  expect(secondGet).not.toHaveBeenCalled();
  await api.assertAgentUse('run', second.clientLeaseId, 'agent');
  expect(secondGet).toHaveBeenCalledTimes(1);
  await api.notify('run', first.clientLeaseId, []);
  await expect(api.assertAgentUse('run', first.clientLeaseId, 'agent')).rejects.toThrow(
    'not owned'
  );
  await expect(api.assertAgentUse('run', 'unadmitted', 'agent')).rejects.toThrow('not owned');
  await expect(api.assertAgentUse('run', second.clientLeaseId, 'agent')).resolves.toBeUndefined();
  expect(getOptions).toHaveBeenCalledTimes(2);
  await api.notify('run', second.clientLeaseId, []);
});

it('uses one abort listener for parallel clients and removes it after the last release', async () => {
  const { api, controller } = setup();
  const added = jest.spyOn(controller.signal, 'addEventListener');
  const removed = jest.spyOn(controller.signal, 'removeEventListener');
  const policies = await Promise.all(Array.from({ length: 16 }, () => api.read('run')));
  expect(added).toHaveBeenCalledTimes(1);
  await Promise.all(policies.map(({ clientLeaseId }) => api.notify('run', clientLeaseId, [])));
  expect(removed).toHaveBeenCalledTimes(1);
  expect(removed).toHaveBeenCalledWith('abort', added.mock.calls[0][1]);
});

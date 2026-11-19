/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock, httpServerMock } from '@kbn/core/server/mocks';
import { loggerMock } from '@kbn/logging-mocks';
import {
  EventActorType,
  TimelineEventType,
  type ConversationTemplate,
  type ConversationAddEventInput,
} from '@kbn/agent-builder-common';
import type { ReportConversationFieldsChangedParams } from '@kbn/agent-builder-common/telemetry/agent_builder_events';
import type { ConversationProperties } from '../services/conversation/client/storage';
import { fromEs } from '../services/conversation/client/converters';
import { describeConversationWrite } from '../workflows/triggers/describe_conversation_write';
import { describeConversationFieldsChanged } from '../telemetry/describe_conversation_fields_changed';
import { ConversationWriteNotifications } from './conversation_write_notifications';
import { ConversationRegistry } from './conversation_registry';
import { createNativeConversation } from './native_conversation';

const snapshot = (revision: number, fields: Partial<ConversationProperties> = {}) => ({
  _id: 'conversation',
  _index: '.chat-conversations-000001',
  _seq_no: revision * 10,
  _primary_term: 1,
  _version: revision,
  found: true,
  _source: {
    user_id: 'owner',
    user_name: 'owner',
    agent_id: 'agent',
    space: 'default',
    title: 'Conversation',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    conversation_rounds: [],
    events: [],
    schema_version: 1,
    ...fields,
  },
});

const setup = () => {
  const esClient = elasticsearchServiceMock.createElasticsearchClient();
  esClient.indices.get.mockResolvedValue({});
  esClient.indices.getAlias.mockResolvedValue({});
  esClient.indices.putIndexTemplate.mockResolvedValue({ acknowledged: true });
  esClient.indices.create.mockResolvedValue({
    acknowledged: true,
    shards_acknowledged: true,
    index: '.chat-conversations-000001',
  });
  const logger = loggerMock.create();
  const user = { id: 'owner', username: 'owner', isAdmin: false };
  const template: ConversationTemplate = {
    id: 'fixture',
    version: 1,
    name: 'Fixture',
    fields: { status: { input_type: 'SELECT', options: ['open', 'closed'], report_changes: true } },
  };
  const context = {
    esClient,
    logger,
    user,
    space: 'default',
    agentRegistry: { get: async () => {}, getIds: async () => ['agent'] },
    validateEvents: async (events: ConversationAddEventInput[]) => events,
    templateLookup: (id: string) => (id === template.id ? template : undefined),
    onConversationCreated: jest.fn(),
    reportFieldsChange: jest.fn<void, [ReportConversationFieldsChangedParams]>(),
    eventEmitter: {
      emitAttachmentEvents: jest.fn(),
      emitConversationUpdated: jest.fn(),
      emitMetadataPatched: jest.fn(),
    },
  };
  const writes = new ConversationWriteNotifications('run', context);
  return { context, writes, get: esClient.get, index: esClient.index };
};

it('rebuilds metadata, update and telemetry hooks with the original before/after descriptions', async () => {
  const { writes, context, get } = setup();
  const before = snapshot(4, { template_id: 'fixture', metadata: { status: 'open' } });
  const after = snapshot(5, { template_id: 'fixture', metadata: { status: 'closed' } });
  get.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
  const { writeLeaseId } = await writes.prepare('conversation', { seqNo: 40, primaryTerm: 1 });
  await writes.notify([
    { operation: 'emitMetadataPatched', conversationId: 'conversation', writeLeaseId },
    { operation: 'emitConversationUpdated', conversationId: 'conversation', writeLeaseId },
    { operation: 'fieldsChanged', conversationId: 'conversation', writeLeaseId },
  ]);
  const describe = {
    before: fromEs(before, context.user),
    after: fromEs(after, context.user),
    source: 'workflow' as const,
  };
  expect(context.eventEmitter.emitMetadataPatched).toHaveBeenCalledWith({
    conversationId: 'conversation',
    templateId: 'fixture',
    changedFields: ['status'],
  });
  expect(context.eventEmitter.emitConversationUpdated).toHaveBeenCalledWith(
    describeConversationWrite(describe)
  );
  expect(context.reportFieldsChange).toHaveBeenCalledWith(
    describeConversationFieldsChanged({ ...describe, resolveTemplate: context.templateLookup })
  );
  expect(context.reportFieldsChange.mock.calls[0][0]).toMatchObject({
    changes: [{ field: 'status', previous_value: 'open', next_value: 'closed' }],
  });
  expect(get).toHaveBeenCalledTimes(2);
});

it('authorizes the conversation target before hooks and refuses a foreign id even with a valid write reference', async () => {
  const { writes, context, get } = setup();
  get.mockResolvedValueOnce(snapshot(1));
  const { writeLeaseId } = await writes.prepare('conversation', { seqNo: 10, primaryTerm: 1 });
  await expect(
    writes.notify([
      { operation: 'emitConversationUpdated', conversationId: 'foreign', writeLeaseId },
    ])
  ).rejects.toThrow('authorized write');
  expect(context.eventEmitter.emitConversationUpdated).not.toHaveBeenCalled();
  expect(get).toHaveBeenCalledTimes(1);
});

it('rechecks original converse authorization at notify, without firing hooks for an inaccessible stored target', async () => {
  const { writes, context, get } = setup();
  get
    .mockResolvedValueOnce(snapshot(1))
    .mockResolvedValueOnce(snapshot(2, { user_id: 'foreign-owner' }));
  const { writeLeaseId } = await writes.prepare('conversation', { seqNo: 10, primaryTerm: 1 });
  await expect(
    writes.notify([
      { operation: 'emitConversationUpdated', conversationId: 'conversation', writeLeaseId },
    ])
  ).rejects.toMatchObject({ code: 'conversationNotFound' });
  expect(context.eventEmitter.emitConversationUpdated).not.toHaveBeenCalled();
});

it('uses persisted attachment metadata, ignoring spoofed descriptive payloads and rejecting unknown event ids', async () => {
  const { writes, context, get } = setup();
  const event = {
    id: 'persisted-event',
    type: TimelineEventType.attachmentAdded,
    created_at: '2026-01-01',
    actor: { type: EventActorType.user, id: 'owner' },
    data: {
      attachment_id: 'real-attachment',
      attachment_type: 'text',
      current_version: 1,
      source: 'workflow' as const,
    },
  };
  get.mockResolvedValueOnce(snapshot(1)).mockResolvedValue(snapshot(2, { events: [event] }));
  const { writeLeaseId } = await writes.prepare('conversation', { seqNo: 10, primaryTerm: 1 });
  await writes.notify([
    Object.assign(
      {
        operation: 'emitAttachmentEvents' as const,
        conversationId: 'conversation',
        writeLeaseId,
        eventIds: [event.id],
      },
      { payload: { events: [{ ...event, data: { attachment_id: 'spoofed' } }] } }
    ),
  ]);
  expect(context.eventEmitter.emitAttachmentEvents).toHaveBeenCalledWith({
    conversationId: 'conversation',
    events: [event],
  });
  context.eventEmitter.emitAttachmentEvents.mockClear();
  await expect(
    writes.notify([
      {
        operation: 'emitAttachmentEvents',
        conversationId: 'conversation',
        writeLeaseId,
        eventIds: ['missing'],
      },
    ])
  ).rejects.toThrow('authorized write');
  expect(context.eventEmitter.emitAttachmentEvents).not.toHaveBeenCalled();
});

it('derives created audit agent identity from the authorized persisted conversation', async () => {
  const { writes, context, get } = setup();
  get.mockRejectedValueOnce({ statusCode: 404 }).mockResolvedValueOnce(snapshot(1));
  const { writeLeaseId } = await writes.prepare('conversation', undefined);
  await writes.notify([
    Object.assign(
      { operation: 'created' as const, conversationId: 'conversation', writeLeaseId },
      { payload: { agentId: 'spoofed-agent' } }
    ),
  ]);
  expect(context.onConversationCreated).toHaveBeenCalledWith({
    conversationId: 'conversation',
    agentId: 'agent',
  });
});

it('fails closed with a coordinator warning when another write lands before the notify read', async () => {
  const { writes, context, get } = setup();
  get
    .mockResolvedValueOnce(snapshot(1, { metadata: { status: 'open' } }))
    .mockResolvedValueOnce(snapshot(3, { metadata: { status: 'different-writer' } }));
  const { writeLeaseId } = await writes.prepare('conversation', { seqNo: 10, primaryTerm: 1 });
  await writes.notify([
    { operation: 'emitConversationUpdated', conversationId: 'conversation', writeLeaseId },
    { operation: 'fieldsChanged', conversationId: 'conversation', writeLeaseId },
  ]);
  expect(context.eventEmitter.emitConversationUpdated).not.toHaveBeenCalled();
  expect(context.reportFieldsChange).not.toHaveBeenCalled();
  expect(context.logger.warn).toHaveBeenCalledWith(
    expect.stringContaining('expected document version 2, found 3')
  );
});

it('fails as an original OCC conflict when the worker read differs from the coordinator capture', async () => {
  const { context, get, index } = setup();
  get.mockResolvedValueOnce(snapshot(1)).mockResolvedValueOnce(snapshot(2));
  const request = httpServerMock.createKibanaRequest();
  const registry = new ConversationRegistry(
    {
      get: jest.fn().mockReturnValue(request),
      getRunState: jest.fn(),
      resolveStepType: jest.fn(),
      resolveStepOutputLimit: jest.fn(),
      admitChild: jest.fn(),
      getAbortSignal: () => new AbortController().signal,
    },
    async () => context
  );
  const native = await createNativeConversation({
    registry,
    scopeId: 'run',
    esClient: context.esClient,
    logger: context.logger,
  });
  try {
    await expect(
      native.client.update({ id: 'conversation', title: 'Changed' }, { source: 'workflow' })
    ).rejects.toMatchObject({ code: 'conversationWriteConflict' });
    expect(index).not.toHaveBeenCalled();
    expect(context.eventEmitter.emitConversationUpdated).not.toHaveBeenCalled();
  } finally {
    await native.drain();
  }
});

it('uses the captured OCC tokens and never notifies after a competing write wins before index', async () => {
  const { context, get, index } = setup();
  get.mockResolvedValue(snapshot(1));
  index.mockRejectedValueOnce(
    Object.assign(new Error('Concurrent writer won'), { statusCode: 409 })
  );
  const registry = new ConversationRegistry(
    {
      get: jest.fn().mockReturnValue(httpServerMock.createKibanaRequest()),
      getRunState: jest.fn(),
      resolveStepType: jest.fn(),
      resolveStepOutputLimit: jest.fn(),
      admitChild: jest.fn(),
      getAbortSignal: () => new AbortController().signal,
    },
    async () => context
  );
  const native = await createNativeConversation({
    registry,
    scopeId: 'run',
    esClient: context.esClient,
    logger: context.logger,
  });
  try {
    await expect(
      native.client.update({ id: 'conversation', title: 'Changed' }, { source: 'workflow' })
    ).rejects.toMatchObject({ code: 'conversationWriteConflict' });
    expect(index).toHaveBeenCalledWith(
      expect.objectContaining({ if_seq_no: 10, if_primary_term: 1 })
    );
  } finally {
    await native.drain();
  }
  expect(context.eventEmitter.emitConversationUpdated).not.toHaveBeenCalled();
  expect(context.reportFieldsChange).not.toHaveBeenCalled();
});

it('rejects duplicate write notifications before any listener can fire twice', async () => {
  const { writes, context, get } = setup();
  get.mockResolvedValueOnce(snapshot(1)).mockResolvedValueOnce(snapshot(2));
  const { writeLeaseId } = await writes.prepare('conversation', { seqNo: 10, primaryTerm: 1 });
  const notification = {
    operation: 'emitConversationUpdated' as const,
    conversationId: 'conversation',
    writeLeaseId,
  };
  await expect(writes.notify([notification, notification])).rejects.toThrow('Duplicate');
  expect(context.eventEmitter.emitConversationUpdated).not.toHaveBeenCalled();
});

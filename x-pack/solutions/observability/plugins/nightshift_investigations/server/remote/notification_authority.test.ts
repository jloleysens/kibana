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
import { createRoutingTestContext } from '../lib/notifications/notification_routing.mock';
import { NotificationAuthority } from './notification_authority';
import type { NotificationAuthorityApi } from './notification_authority_tokens';

const setup = () => {
  const controller = new AbortController();
  const request = httpServerMock.createKibanaRequest();
  const scopes: ScopeLookup = {
    get: jest.fn().mockReturnValue(request),
    getRunState: jest
      .fn()
      .mockReturnValue({ spaceId: 'ops', workflowRunId: 'run', workflowId: 'managed' }),
    resolveStepType: jest.fn().mockReturnValue('nightshift.handleInvestigationFailure'),
    resolveStepOutputLimit: jest.fn(),
    admitChild: jest.fn(),
    getAbortSignal: (scopeId) => {
      if (scopeId !== 'scope') throw new Error('Foreign scope');
      return controller.signal;
    },
  };
  const routing = createRoutingTestContext('ops');
  const destinations = [{ type: 'slack', connector_id: 'connector', params: { channel: 'C123' } }];
  const client = {
    getInvestigationExecutionContext: jest.fn().mockResolvedValue({
      investigation: { investigation_id: 'inv-1', title: 'Original' },
      workflowId: 'managed',
      conversationId: 'conv-1',
      notificationDestinations: destinations,
    }),
    ensureForFailure: jest.fn().mockResolvedValue('conv-1'),
    getLifecycleSubject: jest.fn().mockResolvedValue({
      subject: { type: 'manual', id: 'original' },
      triggerType: 'manual',
      startedAt: '2026-01-01T00:00:00.000Z',
    }),
    claimSlackThread: jest.fn().mockResolvedValue(true),
    recordSlackThreadStatusMessage: jest.fn(),
  };
  const emitter = jest.fn(() => new Promise<void>(() => {}));
  const getClient = jest.fn().mockReturnValue(client);
  const api = new NotificationAuthority(scopes, {
    getInvestigationsClient: getClient,
    getRoutingClient: jest.fn().mockResolvedValue(routing.client),
    getActions: jest
      .fn()
      .mockReturnValue({ getActionsClientWithRequestInSpace: jest.fn().mockResolvedValue({}) }),
    investigationLocator: { getRedirectUrl: jest.fn().mockReturnValue('/s/ops/investigation') },
    getTriggerEmitter: () => emitter,
  });
  return { api, client, controller, scopes, request, getClient, emitter, routing, destinations };
};

it('uses coordinator request/Space/run and original execution context and failure ensure', async () => {
  const { api, client, request, getClient } = setup();
  const opened = await api.open('scope', 'step', 'inv-1');
  await api.ensureFailure('scope', 'step', 'inv-1');
  expect(opened.context.conversationId).toBe('conv-1');
  expect(getClient).toHaveBeenCalledWith(request, 'ops');
  expect(client.getInvestigationExecutionContext).toHaveBeenCalledWith('inv-1', 'run');
  expect(client.ensureForFailure).toHaveBeenCalledWith('inv-1', 'run');
});

it('rejects foreign scopes, references and unknown step types before accessing live resources', async () => {
  const { api, scopes, getClient, controller } = setup();
  const opened = await api.open('scope', 'step', 'inv-1');
  getClient.mockClear();
  await expect(api.get('foreign', opened.reference)).rejects.toThrow('Foreign scope');
  await expect(api.get('scope', 'forged')).rejects.toThrow('not owned');
  scopes.resolveStepType = () => 'unregistered';
  await expect(api.open('scope', 'step', 'inv-1')).rejects.toThrow('Unknown notification step');
  expect(getClient).not.toHaveBeenCalled();
  controller.abort();
  await expect(api.get('scope', opened.reference)).rejects.toThrow();
});

it('rejects another execution receipt and Slack-thread resources before mutating persistence', async () => {
  const { api, routing, destinations, client } = setup();
  const { reference } = await api.open('scope', 'step', 'inv-1');
  const original = await routing.client.initialize('foreign-run', 'managed', destinations);
  const destination = original.destinations[0].id;
  await routing.client.claim('foreign-run', destination, 'started', 'foreign-attempt', true);
  await expect(
    api.record('scope', reference, 'foreign-attempt', {
      status: 'sent',
      message_ts: '1.2',
      channel: 'C123',
    })
  ).rejects.toThrow('not owned');
  await expect(
    api.claimSlackThread('scope', reference, {
      investigationId: 'forged',
      externalConversationId: 'foreign',
      channel: 'C123',
      threadTs: '1.2',
    })
  ).rejects.toThrow('not owned');
  expect(client.claimSlackThread).not.toHaveBeenCalled();
  expect((await routing.client.get())?.attempts[0].status).toBe('unconfirmed');
});

it('authors the original lifecycle payload only after failure selection and never awaits emitter work', async () => {
  const { api, emitter } = setup();
  const { reference } = await api.open('scope', 'step', 'inv-1');
  await expect(api.emitFailure('scope', reference)).rejects.toThrow('not selected');
  await api.initialize('scope', reference);
  await api.selectTerminalPhase('scope', reference, 'failed');
  await api.emitFailure('scope', reference);
  expect(emitter).toHaveBeenCalledWith(
    'nightshift-investigations.failed',
    expect.objectContaining({
      investigation_id: 'inv-1',
      subject: { type: 'manual', id: 'original' },
      trigger_type: 'manual',
      started_at: '2026-01-01T00:00:00.000Z',
      status: 'failed',
      completed_at: expect.any(String),
    })
  );
});

it('keeps original routing semantics over serialized RPC without accepting execution provenance', async () => {
  const { api } = setup();
  const { port1, port2 } = new MessageChannel();
  const remote = openPortSession<NotificationAuthorityApi>(port1);
  openPortSession(port2, expose(api));
  try {
    const { reference } = await remote.open('scope', 'step', 'inv-1');
    const initialized = await remote.initialize('scope', reference);
    expect(initialized.executions).toEqual([
      { id: 'run', workflow_id: 'managed', destination_ids: [expect.any(String)] },
    ]);
    await remote.claim(
      'scope',
      reference,
      initialized.destinations[0].id,
      'started',
      'attempt',
      true
    );
    await remote.record('scope', reference, 'attempt', {
      status: 'sent',
      message_ts: '1.2',
      channel: 'C123',
    });
    expect((await remote.get('scope', reference))?.attempts[0].status).toBe('sent');
    expect('issue' in expose(api)).toBe(false);
  } finally {
    port1.close();
    port2.close();
  }
});

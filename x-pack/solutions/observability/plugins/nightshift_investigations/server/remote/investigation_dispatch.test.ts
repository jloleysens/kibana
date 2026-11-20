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
import { InvestigationDispatch } from './investigation_dispatch';
import type { InvestigationDispatchApi } from './investigation_dispatch_tokens';
import { restoreDispatchError } from './dispatch_errors';
import { AutomationDailyLimitReachedError, InvestigationQuotaDeniedError } from '../client/errors';

const input: Parameters<InvestigationDispatchApi['start']>[2] = {
  subject: { type: 'manual', id: 'manual' },
  trigger_type: 'manual',
  message: 'Investigate',
};
const setup = () => {
  const request = httpServerMock.createKibanaRequest();
  const controller = new AbortController();
  const scopes: ScopeLookup = {
    get: jest.fn().mockReturnValue(request),
    getRunState: jest
      .fn()
      .mockReturnValue({ spaceId: 'ops', workflowId: 'workflow', workflowRunId: 'execution' }),
    getAbortSignal: (id) => {
      if (id !== 'run' && id !== 'other') throw new Error('Foreign scope');
      return controller.signal;
    },
    resolveStepType: jest.fn(),
    resolveStepOutputLimit: jest.fn(),
    admitChild: jest.fn(),
  };
  const prepared = { client: { start: jest.fn() } };
  const operations = {
    prepare: jest.fn().mockResolvedValue(prepared),
    resolveAlerts: jest.fn().mockResolvedValue([]),
    start: jest.fn().mockResolvedValue({ investigation_id: 'persisted' }),
    notifyQuota: jest.fn().mockResolvedValue(undefined),
  };
  return {
    request,
    controller,
    scopes,
    prepared,
    operations,
    api: new InvestigationDispatch(scopes, operations),
  };
};

it('uses original trusted request/Space/workflow and one-use run-owned dispatch references', async () => {
  const { api, operations, prepared, request } = setup();
  const reference = await api.prepare('run', 'automation');
  expect(operations.prepare).toHaveBeenCalledWith(request, 'ops', 'workflow', 'automation');
  await expect(api.start('other', reference, input)).rejects.toThrow('not owned');
  await expect(
    api.start('run', reference, {
      ...input,
      workflowId: 'forged',
      spaceId: 'foreign',
    } as typeof input)
  ).resolves.toEqual({ investigation_id: 'persisted' });
  expect(operations.start).toHaveBeenCalledWith(prepared, expect.objectContaining(input));
  expect(operations.start.mock.calls[0][1]).not.toHaveProperty('spaceId');
  expect(operations.start.mock.calls[0][1]).not.toHaveProperty('workflowId');
  await expect(api.start('run', reference, input)).rejects.toThrow('not owned');
  expect(Object.getOwnPropertyNames(Object.getPrototypeOf(expose(api))).sort()).toEqual([
    'constructor',
    'notifyQuota',
    'prepare',
    'resolveAlerts',
    'start',
  ]);
});

it('requires a real original quota denial before consuming the original once-per-day notice budget', async () => {
  const { api, operations, request, controller } = setup();
  const reference = await api.prepare('run');
  await expect(api.notifyQuota('run', reference, 'http://kibana')).rejects.toThrow(
    'denied dispatch'
  );
  const slackThread = { workspace: 'workspace', channel: 'channel', thread_ts: 'timestamp' };
  operations.start.mockRejectedValueOnce(new InvestigationQuotaDeniedError());
  await expect(
    restoreDispatchError(api.start('run', reference, { ...input, slack_thread: slackThread }))
  ).rejects.toBeInstanceOf(InvestigationQuotaDeniedError);
  await api.notifyQuota('run', reference, 'http://kibana');
  expect(operations.notifyQuota).toHaveBeenCalledWith(
    request,
    'ops',
    'http://kibana',
    controller.signal,
    expect.anything(),
    slackThread
  );
  await expect(api.notifyQuota('run', reference, 'http://kibana')).rejects.toThrow(
    'denied dispatch'
  );
  expect(operations.notifyQuota).toHaveBeenCalledTimes(1);
});

it('rejects foreign/closed scopes and closure during preparation before dispatching or publishing references', async () => {
  const { api, operations, controller } = setup();
  await expect(api.prepare('foreign')).rejects.toThrow('Foreign');
  operations.prepare.mockImplementationOnce(async () => {
    controller.abort();
    return { client: { start: jest.fn() } };
  });
  await expect(api.prepare('run')).rejects.toThrow();
  await expect(api.resolveAlerts('run', 'alert')).rejects.toThrow();
  expect(operations.start).not.toHaveBeenCalled();
  expect(operations.resolveAlerts).not.toHaveBeenCalled();
});

it.each([new AutomationDailyLimitReachedError(7), new InvestigationQuotaDeniedError()])(
  'preserves original quota constructors/limits over serialized RPC without private error metadata: %p',
  async (original) => {
    const { api, operations } = setup();
    Object.assign(original, { headers: { authorization: 'private-quota' } });
    operations.start.mockRejectedValueOnce(original);
    const { port1, port2 } = new MessageChannel();
    try {
      const remote = openPortSession<InvestigationDispatchApi>(port1);
      openPortSession(port2, expose(api));
      const reference = await remote.prepare('run');
      try {
        await restoreDispatchError(remote.start('run', reference, input));
        throw new Error('Expected denial');
      } catch (error) {
        expect(error).toBeInstanceOf(original.constructor);
        expect(error.message).toBe(original.message);
        expect(JSON.stringify(error)).not.toContain('private-quota');
        if (original instanceof AutomationDailyLimitReachedError) expect(error.limit).toBe(7);
      }
    } finally {
      port1.close();
      port2.close();
    }
  }
);

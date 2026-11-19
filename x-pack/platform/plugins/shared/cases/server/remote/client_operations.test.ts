/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { MessageChannel } from 'node:worker_threads';
import { expose, openPortSession } from '@kbn/core-remote-common';
import { ExecutionError } from '@kbn/workflows-runtime';
import { httpServerMock } from '@kbn/core/server/mocks';
import { createCasesClientMock } from '../client/mocks';
import { CaseSchema } from '../../common/types/domain/case/v1';
import { createCaseResponseFixture } from '../../common/fixtures/create_case';
import { CasesClientOperations } from './client_operations';
import type { CasesClientOperationsApi } from './client_operations_tokens';
import { createWorkflowCasesClient } from './create_workflow_client';

const setup = () => {
  const request = httpServerMock.createKibanaRequest();
  const controller = new AbortController();
  const client = createCasesClientMock();
  const getClient = jest.fn(async () => client);
  const scopes = {
    get: jest.fn().mockImplementation((scopeId: string) => {
      if (scopeId !== 'run') throw new Error('Foreign scope');
      return request;
    }),
    getRunState: jest.fn(),
    admitChild: jest.fn(),
    getAbortSignal: (scopeId: string) => {
      if (scopeId !== 'run') throw new Error('Foreign scope');
      return controller.signal;
    },
  };
  const api = new CasesClientOperations(scopes, getClient, true, () => false);
  return { api, client, request, controller, getClient };
};

it('binds get and find to the original request-scoped Cases client', async () => {
  const { api, client, request, getClient } = setup();
  const response = CaseSchema.parse({
    ...createCaseResponseFixture,
    comments: [],
    assignees: [],
    category: null,
    customFields: [],
  });
  client.cases.get.mockResolvedValue(response);
  await expect(api.caseGet('run', [{ id: 'case', includeComments: false }])).resolves.toEqual(
    response
  );
  expect(getClient).toHaveBeenCalledWith(request, undefined);
  expect(client.cases.get).toHaveBeenCalledWith({ id: 'case', includeComments: false });
  await api.caseFind('run', [{ owner: ['cases'], search: 'original' }]);
  expect(client.cases.find).toHaveBeenCalledWith({ owner: ['cases'], search: 'original' });
  expect('invoke' in api).toBe(false);
});

it('preserves original Cases authorization errors and refuses foreign or closed scopes', async () => {
  const { api, client, controller, getClient } = setup();
  const denied = new Error('Original Cases authorization denied');
  client.cases.get.mockRejectedValueOnce(denied);
  await expect(api.caseGet('run', [{ id: 'case' }])).rejects.toMatchObject({
    name: denied.name,
    message: denied.message,
  });
  await expect(api.caseGet('foreign', [{ id: 'case' }])).rejects.toThrow('Foreign scope');
  controller.abort();
  await expect(api.caseGet('run', [{ id: 'case' }])).rejects.toThrow();
  expect(getClient).toHaveBeenCalledTimes(1);
});

it('refuses business calls if the scope closed while acquiring the client', async () => {
  const { api, client, controller, getClient } = setup();
  getClient.mockImplementationOnce(async () => {
    controller.abort();
    return client;
  });
  await expect(api.caseGet('run', [{ id: 'case' }])).rejects.toThrow();
  expect(client.cases.get).not.toHaveBeenCalled();
});

it('keeps template feature configuration coordinator-owned and scoped', async () => {
  const { api, controller } = setup();
  await expect(api.templatesEnabled('run')).resolves.toBe(true);
  controller.abort();
  await expect(api.templatesEnabled('run')).rejects.toThrow();
});

it('preserves feature-gated workflow registration before any business call', async () => {
  const { api, getClient } = setup();
  await expect(
    api.assertConditionalStep('run', 'cases.setExtendedFields')
  ).resolves.toBeUndefined();
  await expect(api.assertConditionalStep('run', 'cases.addAttachments')).rejects.toThrow(
    'not registered'
  );
  expect(getClient).not.toHaveBeenCalled();
});

it('does not expose a generic client callback over RPC', () => {
  const { api } = setup();
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(expose(api)));
  expect(methods).toContain('caseCreate');
  expect(methods).toContain('caseFind');
  expect(methods).not.toContain('call');
});

it.each(['CaseError', 'TypeError'])('preserves %s through actual serialized RPC', async (name) => {
  const { api, client } = setup();
  const denied =
    name === 'TypeError' ? new TypeError('Original failure') : new Error('Original failure');
  denied.name = name;
  client.cases.get.mockRejectedValue(denied);
  const { port1, port2 } = new MessageChannel();
  try {
    const remote = openPortSession<CasesClientOperationsApi>(port1);
    openPortSession(port2, expose(api));
    const facade = createWorkflowCasesClient(remote, 'run');
    await expect(facade.cases.get({ id: 'case' })).rejects.toMatchObject({
      name,
      message: 'Original failure',
    });
    try {
      await facade.cases.get({ id: 'case' });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      expect(ExecutionError.fromError(error).toSerializableObject()).toMatchObject({ type: name });
      if (name === 'TypeError') expect(error).toBeInstanceOf(TypeError);
    }
  } finally {
    port1.close();
    port2.close();
  }
});

it('does not export private service metadata or authorization headers on errors', async () => {
  const { api, client } = setup();
  const original = Object.assign(new TypeError('Original validation failure'), {
    meta: { request: { headers: { authorization: 'fake-private-authorization' } } },
  });
  client.cases.get.mockRejectedValue(original);
  const { port1, port2 } = new MessageChannel();
  try {
    const remote = openPortSession<CasesClientOperationsApi>(port1);
    openPortSession(port2, expose(api));
    const facade = createWorkflowCasesClient(remote, 'run');
    try {
      await facade.cases.get({ id: 'case' });
      throw new Error('Expected original failure');
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect(error).toMatchObject({ name: 'TypeError', message: 'Original validation failure' });
      expect(JSON.stringify(error)).not.toMatch(/authorization|fake-private|headers|request/);
    }
    expect(original.meta.request.headers.authorization).toBe('fake-private-authorization');
  } finally {
    port1.close();
    port2.close();
  }
});

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { MessageChannel } from 'node:worker_threads';
import { expose, openPortSession } from '@kbn/core-remote-common';
import { httpServerMock } from '@kbn/core-http-server-mocks';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { Investigations } from './investigations';
import type { InvestigationsApi } from './investigations_tokens';
import { ModelSelection } from './model_selection';
import { restoreInvestigationError } from './investigation_errors';
import { FollowUpRecoveredAlertStep } from './follow_up_recovered_alert_step';
import { ResolveModelStep } from './resolve_model_step';

const input = {
  alertUuid: 'alert',
  alertId: 'instance',
  ruleId: 'rule',
  ruleName: 'Rule',
  ruleTypeId: 'type',
};
const setup = () => {
  const controller = new AbortController();
  const request = httpServerMock.createKibanaRequest();
  const scopes: ScopeLookup = {
    get: jest.fn().mockImplementation(() => request),
    getRunState: jest.fn().mockReturnValue({
      spaceId: 'ops',
      workflowRunId: 'execution',
      workflowId: 'workflow',
      workflowName: 'Workflow',
      admittedChildren: new Set(),
    }),
    resolveStepType: jest.fn(),
    resolveStepOutputLimit: jest.fn(),
    admitChild: jest.fn(),
    getAbortSignal: (scopeId) => {
      if (scopeId !== 'run') throw new Error('Foreign run');
      return controller.signal;
    },
  };
  const followUpRecoveredAlert = jest
    .fn()
    .mockResolvedValue({ investigation_id: 'investigation', execution_id: 'execution' });
  const getNotifiableInvestigation = jest
    .fn()
    .mockResolvedValue({ investigation_id: 'investigation', title: 'Original title' });
  const getClient = jest
    .fn()
    .mockReturnValue({ followUpRecoveredAlert, getNotifiableInvestigation });
  const locator = { getRedirectUrl: jest.fn().mockReturnValue('/s/ops/app/r?original') };
  const api = new Investigations(scopes, getClient, locator);
  const resolveModel = jest.fn().mockResolvedValue('selected');
  const models = new ModelSelection(scopes, resolveModel);
  return {
    api,
    models,
    controller,
    scopes,
    request,
    getClient,
    followUpRecoveredAlert,
    getNotifiableInvestigation,
    locator,
    resolveModel,
  };
};

it('uses the original scoped request, trusted Space and original investigation read/locator', async () => {
  const { api, request, getClient, getNotifiableInvestigation, locator } = setup();
  await expect(api.getRenderingInput('run', 'investigation')).resolves.toEqual({
    investigation: { investigation_id: 'investigation', title: 'Original title' },
    redirectUrl: '/s/ops/app/r?original',
  });
  expect(getClient).toHaveBeenCalledWith(request, 'ops');
  expect(getNotifiableInvestigation).toHaveBeenCalledWith('investigation');
  expect(locator.getRedirectUrl).toHaveBeenCalledWith(
    { investigationId: 'investigation' },
    { spaceId: 'ops' }
  );
  expect('invoke' in expose(api)).toBe(false);
});

it('copies only original recovery resource input, never worker run/Space/provenance', async () => {
  const { api, request, getClient, followUpRecoveredAlert } = setup();
  await api.followUpRecoveredAlert('run', {
    ...input,
    spaceId: 'foreign',
    executionId: 'forged',
  } as typeof input);
  expect(getClient).toHaveBeenCalledWith(request, 'ops');
  expect(followUpRecoveredAlert).toHaveBeenCalledWith(input);
});

it('resolves live model policy with only the original request and named model selectors', async () => {
  const { models, request, resolveModel } = setup();
  await expect(
    models.resolve('run', {
      step: 'investigation',
      connector_id: 'selected',
      spaceId: 'foreign',
    } as { step: 'investigation'; connector_id: string })
  ).resolves.toBe('selected');
  expect(resolveModel).toHaveBeenCalledWith(request, {
    step: 'investigation',
    connector_id: 'selected',
  });
  await expect(models.resolve('run', { step: 'foreign' } as never)).rejects.toThrow(
    'Unknown Nightshift'
  );
  expect(resolveModel).toHaveBeenCalledTimes(1);
});

it('refuses foreign, missing-sidecar and closed scopes before service use', async () => {
  const { api, models, scopes, controller, getClient, resolveModel } = setup();
  await expect(api.getRenderingInput('foreign', 'investigation')).rejects.toThrow('Foreign run');
  await expect(models.resolve('foreign', { step: 'investigation' })).rejects.toThrow('Foreign run');
  jest.mocked(scopes.getRunState).mockImplementationOnce(() => {
    throw new Error('Missing sidecar');
  });
  await expect(api.followUpRecoveredAlert('run', input)).rejects.toThrow('Missing sidecar');
  controller.abort();
  await expect(api.followUpRecoveredAlert('run', input)).rejects.toThrow();
  await expect(models.resolve('run', { step: 'investigation' })).rejects.toThrow();
  expect(getClient).not.toHaveBeenCalled();
  expect(resolveModel).not.toHaveBeenCalled();
});

it('refuses a result when its scope closes during the original service call', async () => {
  const { api, controller, getNotifiableInvestigation } = setup();
  getNotifiableInvestigation.mockImplementationOnce(async () => {
    controller.abort();
    return { investigation_id: 'investigation', title: 'Original' };
  });
  await expect(api.getRenderingInput('run', 'investigation')).rejects.toThrow();
});

it.each([Error, TypeError])(
  'preserves original failure names and builtin retry types over real RPC without private metadata (%p)',
  async (ErrorType) => {
    const { api, followUpRecoveredAlert } = setup();
    const original = Object.assign(new ErrorType('Original denial'), {
      name: 'InvestigationUnavailableError',
      headers: { authorization: 'fake-private' },
    });
    followUpRecoveredAlert.mockRejectedValueOnce(original);
    const { port1, port2 } = new MessageChannel();
    try {
      const remote = openPortSession<InvestigationsApi>(port1);
      openPortSession(port2, expose(api));
      await expect(
        restoreInvestigationError(remote.followUpRecoveredAlert('run', input))
      ).rejects.toMatchObject({
        name: original.name,
        message: original.message,
        constructor: ErrorType,
      });
      followUpRecoveredAlert.mockRejectedValueOnce(original);
      try {
        await remote.followUpRecoveredAlert('run', input);
      } catch (error) {
        expect(JSON.stringify(error)).not.toContain('fake-private');
        expect(error).not.toHaveProperty('headers');
      }
      expect(original.headers.authorization).toBe('fake-private');
    } finally {
      port1.close();
      port2.close();
    }
  }
);

it('requires local context for each worker handler', async () => {
  const { api, models } = setup();
  await expect(new FollowUpRecoveredAlertStep(api).run('run', {}, {})).rejects.toThrow('context');
  await expect(new ResolveModelStep(models).run('run', {}, {})).rejects.toThrow('context');
});

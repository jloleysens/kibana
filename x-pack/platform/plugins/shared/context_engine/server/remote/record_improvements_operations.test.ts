/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { MessageChannel } from 'node:worker_threads';
import type { AuditLogger } from '@kbn/core/server';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { expose, openPortSession } from '@kbn/core-remote-common';
import { elasticsearchServiceMock, httpServerMock } from '@kbn/core/server/mocks';
import { ImprovementsService } from '../improvements/service';
import { recordImprovements } from '../feedback_analysis/record_improvements';
import { AiIndexNotFoundError } from '../ai_indices/errors';
import {
  createMockStepContext,
  mockAiIndexService,
  mockKiStepTelemetry,
} from '../step_types/test_utils';
import { RecordImprovementsOperations } from './record_improvements_operations';
import type { RecordImprovementsOperationsApi } from './record_improvements_tokens';
import { RecordImprovementsStep } from './record_improvements_step';
import { restoreKiError } from './ki_errors';

jest.mock('../feedback_analysis/record_improvements');
const record = jest.mocked(recordImprovements);
const result = {
  recorded: [{ improvement_id: 'original-id', action: 'remove_ki' as const, title: 'Original' }],
  skipped: [],
};
const params = {
  aiIndexId: 'index',
  agentRunId: 'agent',
  signalWindow: { from: '2026-01-01', to: '2026-02-01' },
  signalSpaces: ['own-space'],
  proposals: [
    { action: 'remove_ki', title: 'Original', target: { ki_id: 'old' }, signal_ids: ['signal'] },
  ],
};
const setup = () => {
  record.mockReset();
  record.mockResolvedValue(result);
  const controller = new AbortController();
  const request = httpServerMock.createKibanaRequest();
  const esClient = elasticsearchServiceMock.createElasticsearchClient();
  const telemetry = mockKiStepTelemetry();
  const service = mockAiIndexService({ type: 'index', value: 'index' });
  const improvements = new ImprovementsService({
    esClient,
    logger: telemetry.logger,
    space: 'own-space',
  });
  const audit: AuditLogger = { log: jest.fn(), enabled: true, includeSavedObjectNames: true };
  const getScopedEsClient = jest.fn(async () => esClient);
  const getImprovementsService = jest.fn(() => improvements);
  const getAuditLogger = jest.fn(async () => audit);
  const checkWritePrivilege = jest.fn(async () => true);
  const scopes: ScopeLookup = {
    get: jest.fn().mockReturnValue(request),
    getRunState: (scopeId) => {
      if (scopeId !== 'scope') throw new Error('Unknown scope');
      return {
        workflowId: 'trusted',
        workflowRunId: 'trusted-run',
        workflowName: 'Trusted',
        spaceId: 'own-space',
        admittedChildren: new Set(),
      };
    },
    getAbortSignal: (scopeId) => {
      if (scopeId !== 'scope') throw new Error('Unknown scope');
      return controller.signal;
    },
    getRunDefinitionFacts: jest.fn(),
    resolveStepType: jest.fn(),
    resolveStepOutputLimit: jest.fn(),
    admitChild: jest.fn(),
  };
  const isContextEngineEnabled = jest.fn(async () => true);
  const api = new RecordImprovementsOperations(scopes, {
    getAiIndexService: () => service,
    getImprovementsService,
    getAuditLogger,
    checkWritePrivilege,
    getScopedEsClient,
    isContextEngineEnabled,
    isFeedbackLoopEnabled: async () => true,
    logger: telemetry.logger,
  });
  const settings = {
    isContextEngineEnabled: async () => true,
    isFeedbackLoopEnabled: jest.fn(async () => true),
    buildContext: jest.fn(),
  };
  const context = createMockStepContext({
    input: {
      ai_index_id: 'index',
      agent_run_id: 'agent',
      signal_window: params.signalWindow,
      signal_spaces: params.signalSpaces,
      improvements: params.proposals,
    },
    esClient: {},
  });
  return {
    api,
    controller,
    request,
    esClient,
    service,
    improvements,
    audit,
    getScopedEsClient,
    getImprovementsService,
    getAuditLogger,
    checkWritePrivilege,
    isContextEngineEnabled,
    settings,
    context,
  };
};

it('uses own request/space, original policy/store/audit, and ignores forged extra DTO authority', async () => {
  const {
    api,
    request,
    service,
    improvements,
    getScopedEsClient,
    getImprovementsService,
    getAuditLogger,
    audit,
  } = setup();
  jest.mocked(service.get).mockResolvedValue({
    ...(await service.get('index', 'own-space')),
    feedback_analysis: { enabled: true, allowed_actions: ['remove_ki'] },
  });
  const forged = {
    ...params,
    spaceId: 'foreign',
    request: { headers: { authorization: 'forged' } },
    allowedActions: ['add_ki'],
    recorded: 999,
  };
  await expect(api.record('scope', forged)).resolves.toEqual(result);
  expect(getScopedEsClient).toHaveBeenCalledWith(request);
  expect(getAuditLogger).toHaveBeenCalledWith(request);
  expect(getImprovementsService).toHaveBeenCalledWith(expect.anything(), 'own-space');
  expect(record).toHaveBeenCalledWith({
    ...params,
    allowedActions: ['remove_ki'],
    spaceId: 'own-space',
    improvementsService: improvements,
  });
  expect(audit.log).toHaveBeenCalledWith(
    expect.objectContaining({
      message: expect.stringContaining('1 improvement(s)'),
      event: expect.objectContaining({ outcome: 'success' }),
    })
  );
});

it('rechecks original write authorization even when bypassing the thin handler; foreign/closed scopes refuse before clients', async () => {
  const { api, controller, checkWritePrivilege, getScopedEsClient } = setup();
  checkWritePrivilege.mockResolvedValue(false);
  await expect(restoreKiError(api.record('scope', params))).rejects.toMatchObject({
    type: 'PermissionError',
  });
  await expect(api.record('foreign', params)).rejects.toThrow('Unknown scope');
  controller.abort();
  await expect(api.record('scope', params)).rejects.toThrow();
  expect(getScopedEsClient).not.toHaveBeenCalled();
  expect(record).not.toHaveBeenCalled();
});

it('refuses scope closure during client lookup before running the original domain operation', async () => {
  const { api, controller, getScopedEsClient, esClient } = setup();
  getScopedEsClient.mockImplementationOnce(async () => {
    controller.abort();
    return esClient;
  });
  await expect(api.record('scope', params)).rejects.toThrow();
  expect(record).not.toHaveBeenCalled();
});

it('preserves original live not-found masking and failure audit', async () => {
  const { api, service, audit } = setup();
  jest.mocked(service.get).mockRejectedValue(new AiIndexNotFoundError('index'));
  await expect(restoreKiError(api.record('scope', params))).rejects.toMatchObject({
    type: 'NotFoundError',
    message: "AI index 'index' not found",
  });
  expect(audit.log).toHaveBeenCalledWith(
    expect.objectContaining({ event: expect.objectContaining({ outcome: 'failure' }) })
  );
});

it('executes original thin flag/privilege order and output worker-locally without generic context reconstruction', async () => {
  const { api, settings, context, checkWritePrivilege, isContextEngineEnabled } = setup();
  const step = new RecordImprovementsStep(api, settings);
  await expect(step.run('scope', {}, { handlerContext: context })).resolves.toEqual({
    output: result,
  });
  expect(record).toHaveBeenCalledTimes(1);
  isContextEngineEnabled.mockResolvedValue(false);
  settings.isFeedbackLoopEnabled.mockClear();
  await expect(step.run('scope', {}, { handlerContext: context })).rejects.toMatchObject({
    type: 'FeatureDisabledError',
  });
  expect(settings.isFeedbackLoopEnabled).not.toHaveBeenCalled();
  isContextEngineEnabled.mockResolvedValue(true);
  checkWritePrivilege.mockResolvedValue(false);
  await expect(step.run('scope', {}, { handlerContext: context })).rejects.toMatchObject({
    type: 'PermissionError',
  });
  expect(record).toHaveBeenCalledTimes(1);
  await expect(step.run('scope', {}, {})).rejects.toThrow('executor-local handler context');
});

it('preserves original builtin errors over real RPC while stripping arbitrary Authorization metadata', async () => {
  const { api } = setup();
  const original = Object.assign(new TypeError('Original failure'), {
    privateAuthorization: 'private-secret',
  });
  record.mockRejectedValueOnce(original);
  const { port1, port2 } = new MessageChannel();
  try {
    const remote = openPortSession<RecordImprovementsOperationsApi>(port1);
    openPortSession(port2, expose(api));
    try {
      await restoreKiError(remote.record('scope', params));
      throw new Error('Expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect(error).toMatchObject({ message: 'Original failure' });
      expect(JSON.stringify(error)).not.toContain('private-secret');
    }
    expect(original.privateAuthorization).toBe('private-secret');
    expect(api).not.toHaveProperty('invoke');
  } finally {
    port1.close();
    port2.close();
  }
});

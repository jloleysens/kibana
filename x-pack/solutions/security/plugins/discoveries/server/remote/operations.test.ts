/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { MessageChannel } from 'node:worker_threads';
import { of } from 'rxjs';
import { expose, openPortSession } from '@kbn/core-remote-common';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { coreMock, elasticsearchServiceMock, httpServerMock } from '@kbn/core/server/mocks';
import { loggerMock } from '@kbn/logging-mocks';
import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import { DefaultValidationStep } from './default_validation_step';
import { DefaultAlertRetrievalStep } from './default_alert_retrieval_step';
import { createDefaultAlertRetrievalHandler } from '../workflows/steps/default_alert_retrieval_step/default_alert_retrieval_handler';
import { createDefaultAlertRetrievalHandler as publicRetrievalHandler } from '../workflows/steps/default_alert_retrieval_step/get_default_alert_retrieval_step_definition';
import { AttackDiscoveryOperations } from './operations';
import type { AttackDiscoveryOperationsApi } from './tokens';
import { createDefaultValidationHandler } from '../workflows/steps/default_validation_step/default_validation_handler';
import { createDefaultValidationHandler as publicHandler } from '../workflows/steps/default_validation_step/get_default_validation_step_definition';
import { getSpaceId } from '@kbn/discoveries/impl/lib/helpers/get_space_id';
import type { DiscoveriesPluginStartDeps } from '../types';

jest.mock('@kbn/discoveries/impl/lib/helpers/get_space_id', () => ({
  getSpaceId: jest.fn(() => 'trusted-space'),
}));
const input = {
  api_config: { connector_id: 'selected', action_type_id: '.gen-ai' },
  connector_name: '',
  generation_uuid: 'user-evidence',
  attack_discoveries: [
    {
      id: 'discovery',
      timestamp: '2026-01-01T00:00:00.000Z',
      title: 'Original',
      alert_ids: ['alert-original'],
      details_markdown: 'Details',
      summary_markdown: 'Summary',
    },
  ],
};
const setup = () => {
  const controller = new AbortController();
  const request = httpServerMock.createKibanaRequest();
  const scopes: ScopeLookup = {
    get: jest.fn().mockReturnValue(request),
    getRunState: (scope) => {
      if (scope !== 'scope') throw new Error('Foreign scope');
      return {
        workflowId: 'trusted-workflow',
        workflowRunId: 'trusted-run',
        workflowName: 'Trusted',
        spaceId: 'trusted-space',
        admittedChildren: new Set(),
      };
    },
    getAbortSignal: () => controller.signal,
    getRunDefinitionFacts: jest.fn(),
    resolveStepType: jest.fn(),
    resolveStepOutputLimit: jest.fn(),
    admitChild: jest.fn(),
  };
  const coreStart = coreMock.createStart();
  coreStart.featureFlags.getBooleanValue$.mockReturnValue(of(true));
  const esClient = elasticsearchServiceMock.createElasticsearchClient();
  jest.mocked(coreStart.elasticsearch.client.asScoped).mockReturnValue({
    asCurrentUser: esClient,
    asInternalUser: esClient,
    asSecondaryAuthUser: esClient,
  });
  esClient.security.authenticate.mockResponse({
    username: 'original-user',
    roles: [],
    full_name: null,
    email: null,
    metadata: {},
    enabled: true,
    authentication_realm: { name: 'native', type: 'native' },
    lookup_realm: { name: 'native', type: 'native' },
    authentication_type: 'api_key',
  });
  esClient.search.mockResponse({
    took: 1,
    timed_out: false,
    _shards: { total: 1, successful: 1, failed: 0 },
    hits: { hits: [{ _id: 'alert-original', _index: '.alerts-security.alerts-trusted-space' }] },
  });
  const getConnector = jest
    .fn()
    .mockResolvedValue({ actionTypeId: '.gen-ai', name: 'Original connector' });
  const pluginsStart = {
    actions: { getActionsClientWithRequest: jest.fn().mockResolvedValue({ get: getConnector }) },
  } as unknown as DiscoveriesPluginStartDeps;
  const logger = loggerMock.create();
  logger.isLevelEnabled.mockReturnValue(true);
  logger.get.mockReturnValue(logger);
  const getStartServices = jest.fn(async () => ({ coreStart, pluginsStart }));
  const api = new AttackDiscoveryOperations(scopes, { getStartServices, logger });
  const handlerContext = {
    input,
    config: {},
    rawInput: input,
    stepId: 'validate',
    stepType: 'security.attack-discovery.defaultValidation',
    abortSignal: controller.signal,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    contextManager: {
      getScopedEsClient: () => esClient,
      getFakeRequest: () => {
        throw new Error('No coordinator request in worker');
      },
    },
  } as unknown as StepHandlerContext;
  return {
    controller,
    request,
    scopes,
    coreStart,
    esClient,
    getConnector,
    pluginsStart,
    logger,
    getStartServices,
    api,
    handlerContext,
  };
};

it('retains a single original handler owner and runs its nonempty filter/transform on native ES', async () => {
  expect(publicHandler).toBe(createDefaultValidationHandler);
  const { api, handlerContext, esClient, logger, request, pluginsStart } = setup();
  const result = await new DefaultValidationStep(api).run('scope', {}, { handlerContext });
  expect(result).toEqual({
    output: {
      filtered_count: 0,
      validated_discoveries: [
        {
          ...input.attack_discoveries[0],
          connector_id: 'selected',
          connector_name: 'Original connector',
          generation_uuid: 'user-evidence',
        },
      ],
    },
  });
  expect(esClient.search).toHaveBeenCalledWith(
    expect.objectContaining({ index: '.alerts-security.alerts-trusted-space' })
  );
  expect(pluginsStart.actions.getActionsClientWithRequest).toHaveBeenCalledWith(request);
  expect(getSpaceId).toHaveBeenCalledWith(expect.objectContaining({ request }));
  expect(handlerContext.logger.info).toHaveBeenCalledWith(
    'Validating 1 attack discoveries (generation: user-evidence)'
  );
  expect(logger.info).toHaveBeenCalledWith(
    expect.stringContaining('[execution: user-evidence] [VALIDATE]')
  );
  expect(handlerContext.logger.info).not.toHaveBeenCalledWith(
    expect.stringContaining('[VALIDATE]')
  );
});
it('preserves empty and hallucinated outputs and logs without a coordinator algorithm', async () => {
  const { api, handlerContext, esClient } = setup();
  handlerContext.input = { ...input, attack_discoveries: [] };
  await expect(
    new DefaultValidationStep(api).run('scope', {}, { handlerContext })
  ).resolves.toEqual({
    output: { filter_reason: 'no_discoveries', filtered_count: 0, validated_discoveries: [] },
  });
  expect(esClient.search).not.toHaveBeenCalled();
  handlerContext.input = input;
  esClient.search.mockResponse({
    took: 1,
    timed_out: false,
    _shards: { total: 1, successful: 1, failed: 0 },
    hits: { hits: [] },
  });
  await expect(
    new DefaultValidationStep(api).run('scope', {}, { handlerContext })
  ).resolves.toEqual({
    output: {
      filter_reason: 'hallucinated_alert_ids',
      filtered_count: 1,
      validated_discoveries: [],
    },
  });
});
it('keeps the live kill switch outside the original handler catch and refuses missing/foreign/closed scopes', async () => {
  const { api, handlerContext, coreStart, controller, getStartServices } = setup();
  coreStart.featureFlags.getBooleanValue$.mockReturnValue(of(false));
  await expect(new DefaultValidationStep(api).run('scope', {}, { handlerContext })).rejects.toThrow(
    'Attack Discovery workflows are not enabled'
  );
  expect(handlerContext.logger.error).not.toHaveBeenCalled();
  getStartServices.mockClear();
  await expect(api.prepareValidation('foreign', input)).rejects.toThrow('Foreign scope');
  expect(getStartServices).not.toHaveBeenCalled();
  controller.abort();
  await expect(api.checkEnabled('scope')).rejects.toThrow();
  await expect(new DefaultValidationStep(api).run('scope', {}, {})).rejects.toThrow(
    'executor-local'
  );
});
it('rechecks the flag for direct policy calls and preserves authentication-before-connector error order', async () => {
  const { api, coreStart, esClient, getConnector } = setup();
  esClient.security.authenticate.mockRejectedValueOnce(new Error('original authentication'));
  await expect(
    api.prepareValidation('scope', { api_config: { connector_id: '', action_type_id: '' } })
  ).rejects.toThrow('original authentication');
  expect(getConnector).not.toHaveBeenCalled();
  await expect(
    api.prepareValidation('scope', { api_config: { connector_id: '', action_type_id: '' } })
  ).rejects.toThrow('Missing connector_id');
  coreStart.featureFlags.getBooleanValue$.mockReturnValue(of(false));
  await expect(api.prepareValidation('scope', input)).rejects.toThrow(
    'Attack Discovery workflows are not enabled'
  );
});
it('preserves builtin error/name while stripping arbitrary private properties over actual serialized RPC', async () => {
  const { api, esClient, handlerContext } = setup();
  const source = Object.assign(new TypeError('original denied'), {
    name: 'PublicDenial',
    Authorization: 'secret',
    meta: { headers: { authorization: 'secret' } },
  });
  esClient.security.authenticate.mockRejectedValue(source);
  const { port1, port2 } = new MessageChannel();
  openPortSession(port1, expose(api));
  const client = openPortSession<AttackDiscoveryOperationsApi>(port2);
  try {
    const result = await new DefaultValidationStep(client).run('scope', {}, { handlerContext });
    expect(result).toEqual({ error: new Error('original denied') });
    const error = jest.mocked(handlerContext.logger.error).mock.calls[0][1];
    expect(error).toBeInstanceOf(TypeError);
    expect(error?.name).toBe('PublicDenial');
    expect(JSON.stringify(error)).not.toContain('secret');
    expect(error).not.toHaveProperty('meta');
    expect(error).not.toHaveProperty('Authorization');
    expect(source.Authorization).toBe('secret');
    expect(source.name).toBe('PublicDenial');
  } finally {
    port1.close();
    port2.close();
  }
});

const retrievalInput = {
  alerts_index_pattern: 'explicit-user-index',
  size: 10,
  anonymization_fields: [{ id: 'message', field: 'message', allowed: true, anonymized: true }],
  api_config: { connector_id: 'selected', action_type_id: '.gen-ai' },
  replacements: { 'fixed-replacement': 'Original message' },
};
it('shares the original native retrieval/query/anonymization and resolves space only from the coordinator sidecar', async () => {
  expect(publicRetrievalHandler).toBe(createDefaultAlertRetrievalHandler);
  const { api, handlerContext, esClient, request, pluginsStart } = setup();
  handlerContext.input = retrievalInput;
  esClient.search.mockResponse({
    took: 1,
    timed_out: false,
    _shards: { total: 1, successful: 1, failed: 0 },
    hits: {
      hits: [
        {
          _id: 'alert-original',
          _index: 'explicit-user-index',
          fields: { _id: ['alert-original'], message: ['Original message'] },
        },
      ],
    },
  });
  const result = await new DefaultAlertRetrievalStep(api).run('scope', {}, { handlerContext });
  expect(result).toEqual({
    output: {
      alerts: ['_id,alert-original\nmessage,fixed-replacement'],
      alerts_context_count: 1,
      anonymized_alerts: [
        { metadata: {}, page_content: '_id,alert-original\nmessage,fixed-replacement' },
      ],
      api_config: retrievalInput.api_config,
      connector_name: 'Original connector',
      replacements: retrievalInput.replacements,
    },
  });
  expect(esClient.search).toHaveBeenCalledWith(
    expect.objectContaining({ index: ['explicit-user-index'], size: 10 })
  );
  expect(pluginsStart.actions.getActionsClientWithRequest).toHaveBeenCalledWith(request);
});
it('retains no-connector output and original per-space anonymization fallback without trusting worker context', async () => {
  const { api, handlerContext, esClient, getConnector } = setup();
  handlerContext.input = {
    ...retrievalInput,
    size: 0,
    anonymization_fields: [],
    api_config: { connector_id: '', action_type_id: '' },
  };
  esClient.search.mockResponse({
    took: 1,
    timed_out: false,
    _shards: { total: 1, successful: 1, failed: 0 },
    hits: { hits: [] },
  });
  const result = await new DefaultAlertRetrievalStep(api).run('scope', {}, { handlerContext });
  expect(result).toEqual({
    output: {
      alerts: [],
      alerts_context_count: 0,
      anonymized_alerts: [],
      api_config: { connector_id: '', action_type_id: '' },
      connector_name: undefined,
      replacements: retrievalInput.replacements,
    },
  });
  expect(getConnector).not.toHaveBeenCalled();
  expect(esClient.search).toHaveBeenCalledWith({
    index: '.kibana-elastic-ai-assistant-anonymization-fields-trusted-space',
    query: { match_all: {} },
    size: 1000,
  });
});
it('runs the unchanged ES|QL metadata parser locally and preserves original transform/query error outcomes', async () => {
  const { api, handlerContext, esClient } = setup();
  handlerContext.input = { ...retrievalInput, esql_query: 'FROM logs* | KEEP message' };
  esClient.esql.query.mockResponse({
    columns: [
      { name: 'message', type: 'keyword' },
      { name: '_id', type: 'keyword' },
    ],
    values: [['Original message', 'alert-original']],
  });
  const result = await new DefaultAlertRetrievalStep(api).run('scope', {}, { handlerContext });
  expect(result).toMatchObject({
    output: { alerts: ['_id,alert-original\nmessage,fixed-replacement'], alerts_context_count: 1 },
  });
  expect(esClient.esql.query).toHaveBeenCalledWith({
    allow_partial_results: true,
    drop_null_columns: true,
    query: 'FROM logs* METADATA _id | KEEP message, _id',
  });
  const source = new TypeError('original query error');
  esClient.esql.query.mockRejectedValue(source);
  await expect(
    new DefaultAlertRetrievalStep(api).run('scope', {}, { handlerContext })
  ).resolves.toEqual({ error: new Error('original query error') });
  expect(handlerContext.logger.error).toHaveBeenCalledWith('Failed to retrieve alerts', source);
});
it('owns independent retry/parallel retrieval clients and releases references on close or scope abort', async () => {
  const { api, scopes, controller } = setup();
  jest.spyOn(scopes, 'getRunState').mockReturnValue({
    workflowId: 'trusted',
    workflowRunId: 'trusted-run',
    workflowName: 'Trusted',
    spaceId: 'trusted-space',
    admittedChildren: new Set(),
  });
  const references = await Promise.all(Array.from({ length: 8 }, () => api.openRetrieval('scope')));
  expect(new Set(references).size).toBe(8);
  await expect(api.resolveRetrievalConnector('other', references[0], 'selected')).rejects.toThrow(
    'Unknown retrieval reference'
  );
  await expect(api.closeRetrieval('other', references[0])).rejects.toThrow(
    'Unknown retrieval reference'
  );
  await Promise.all(references.map((reference) => api.closeRetrieval('scope', reference)));
  for (const reference of references)
    await expect(api.resolveRetrievalConnector('scope', reference, 'selected')).rejects.toThrow(
      'Unknown retrieval reference'
    );
  const retry = await api.openRetrieval('scope');
  await expect(api.resolveRetrievalConnector('scope', retry, 'selected')).resolves.toEqual({
    connectorName: 'Original connector',
  });
  controller.abort();
  await expect(api.resolveRetrievalConnector('scope', retry, 'selected')).rejects.toThrow();
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(expose(api)));
  expect(methods).not.toContain('invoke');
  expect(methods).not.toContain('#call');
});
it('retains retrieval flag/missing-context refusal before logging or creating a scoped client', async () => {
  const { api, handlerContext, coreStart, pluginsStart } = setup();
  coreStart.featureFlags.getBooleanValue$.mockReturnValue(of(false));
  await expect(
    new DefaultAlertRetrievalStep(api).run('scope', {}, { handlerContext })
  ).rejects.toThrow('Attack Discovery workflows are not enabled');
  expect(pluginsStart.actions.getActionsClientWithRequest).not.toHaveBeenCalled();
  expect(handlerContext.logger.info).not.toHaveBeenCalled();
  await expect(new DefaultAlertRetrievalStep(api).run('scope', {}, {})).rejects.toThrow(
    'executor-local'
  );
});

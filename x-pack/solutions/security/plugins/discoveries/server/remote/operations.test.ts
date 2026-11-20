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
import { ruleRegistryMocks } from '@kbn/rule-registry-plugin/server/mocks';
import { PersistDiscoveriesStep } from './persist_discoveries_step';
import { createPersistDiscoveriesHandler } from '../workflows/steps/persist_discoveries_step/persist_discoveries_handler';
import { createPersistDiscoveriesHandler as publicPersistHandler } from '../workflows/steps/persist_discoveries_step/get_persist_discoveries_step_definition';
import { validateAttackDiscoveries } from '../routes/post/validate/helpers/validate_attack_discoveries';
import { RunStep } from './run_step';
import { createRunHandler } from '../workflows/steps/run_step/run_handler';
import { createRunHandler as publicRunHandler } from '../workflows/steps/run_step/get_run_step_definition';
import { executeGenerationWorkflow } from '@kbn/discoveries/impl/attack_discovery/generation/execute_generation_workflow';
jest.mock('../routes/post/validate/helpers/validate_attack_discoveries', () => ({
  validateAttackDiscoveries: jest.fn(),
}));
jest.mock('@kbn/discoveries/impl/attack_discovery/generation/execute_generation_workflow', () => ({
  executeGenerationWorkflow: jest.fn(),
}));
jest.mock('../lib/is_workflows_enabled_for_space', () => ({
  isWorkflowsEnabledForSpace: async () => true,
}));
const mockedValidateAttackDiscoveries = jest.mocked(validateAttackDiscoveries);
const mockedExecuteGenerationWorkflow = jest.mocked(executeGenerationWorkflow);
import { GenerateStep } from './generate_step';
import {
  createGenerateHandler,
  type GenerationResult,
} from '../workflows/steps/generate_step/generate_handler';
import { createGenerateHandler as publicGenerateHandler } from '../workflows/steps/generate_step/get_generate_step_definition';
import { invokeGenerationGraph } from '../workflows/steps/generate_step/helpers/invoke_generation_graph';

jest.mock('../workflows/steps/generate_step/helpers/invoke_generation_graph', () => ({
  invokeGenerationGraph: jest.fn(),
}));
const mockedInvokeGenerationGraph = jest.mocked(invokeGenerationGraph);

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
  const request = httpServerMock.createKibanaRequest({
    headers: { authorization: 'ApiKey original-coordinator-run-credential' },
  });
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
    security: { authz: {} },
  } as unknown as DiscoveriesPluginStartDeps;
  const logger = loggerMock.create();
  logger.isLevelEnabled.mockReturnValue(true);
  logger.get.mockReturnValue(logger);
  const getStartServices = jest.fn(async () => ({ coreStart, pluginsStart }));
  const api = new AttackDiscoveryOperations(scopes, {
    getStartServices,
    logger,
    connectorTimeout: 60000,
    adhocAttackDiscoveryDataClient: ruleRegistryMocks.createRuleDataClient(),
    getEventLogIndex: async () => 'fixture',
    getEventLogger: async () => {
      throw new Error('Unused event logger');
    },
  });
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

const generationInput = {
  alerts: ['_id,alert-original\nmessage,Original'],
  api_config: { connector_id: 'selected', action_type_id: '.gen-ai' },
  replacements: { masked: 'Original' },
  size: 1,
};
const prepareGenerationFixture = () => {
  const fixture = setup();
  jest.mocked(fixture.scopes.resolveStepType).mockReturnValue('security.attack-discovery.generate');
  fixture.handlerContext.input = generationInput;
  return fixture;
};
it('shares the original generation handler and uses coordinator execution identity and scoped clients', async () => {
  expect(publicGenerateHandler).toBe(createGenerateHandler);
  const { api, handlerContext, request, coreStart, esClient, pluginsStart } =
    prepareGenerationFixture();
  mockedInvokeGenerationGraph.mockResolvedValue({
    discoveries: [
      {
        title: 'Original',
        alertIds: ['alert-original'],
        detailsMarkdown: 'Details',
        summaryMarkdown: 'Summary',
      },
    ],
    replacements: { masked: 'Original' },
    alertsContextCount: 1,
  });
  const result = await new GenerateStep(api).run('scope', {}, { handlerContext });
  expect(result).toEqual({
    output: {
      attack_discoveries: [
        {
          alert_ids: ['alert-original'],
          details_markdown: 'Details',
          entity_summary_markdown: undefined,
          id: 'trusted-run-0',
          mitre_attack_tactics: undefined,
          summary_markdown: 'Summary',
          timestamp: undefined,
          title: 'Original',
        },
      ],
      execution_uuid: 'trusted-run',
      replacements: { masked: 'Original' },
    },
  });
  expect(coreStart.savedObjects.getScopedClient).toHaveBeenCalledWith(request);
  expect(pluginsStart.actions.getActionsClientWithRequest).toHaveBeenCalledWith(request);
  expect(mockedInvokeGenerationGraph).toHaveBeenCalledWith(
    expect.objectContaining({
      sourceAlerts: generationInput.alerts,
      apiConfig: generationInput.api_config,
      esClient,
      connectorTimeout: 60000,
      abortSignal: expect.any(AbortSignal),
    })
  );
});
it('preserves empty generation preparation and null output without invoking the original graph', async () => {
  const { api, handlerContext, pluginsStart } = prepareGenerationFixture();
  handlerContext.input = { ...generationInput, alerts: [] };
  mockedInvokeGenerationGraph.mockClear();
  await expect(new GenerateStep(api).run('scope', {}, { handlerContext })).resolves.toEqual({
    output: {
      attack_discoveries: null,
      execution_uuid: 'trusted-run',
      replacements: generationInput.replacements,
    },
  });
  expect(pluginsStart.actions.getActionsClientWithRequest).toHaveBeenCalled();
  expect(mockedInvokeGenerationGraph).not.toHaveBeenCalled();
});
it('preserves original generation error output and workflow logger error', async () => {
  const { api, handlerContext } = prepareGenerationFixture();
  mockedInvokeGenerationGraph.mockRejectedValueOnce(new TypeError('Original generation failure'));
  await expect(new GenerateStep(api).run('scope', {}, { handlerContext })).resolves.toEqual({
    error: new Error('Original generation failure'),
  });
  expect(handlerContext.logger.error).toHaveBeenCalledWith(
    'Generation failed: Original generation failure',
    expect.any(TypeError)
  );
});
it('rejects unknown scopes and wrong definition types before generation service acquisition', async () => {
  const { api, scopes, getStartServices } = prepareGenerationFixture();
  await expect(api.openGeneration('other', 'generate', generationInput.api_config)).rejects.toThrow(
    'Foreign scope'
  );
  jest.mocked(scopes.resolveStepType).mockReturnValue('ai.agent');
  await expect(api.openGeneration('scope', 'generate', generationInput.api_config)).rejects.toThrow(
    'Not an attack discovery generation step'
  );
  expect(getStartServices).not.toHaveBeenCalled();
});
it('allows parallel/retry generations but refuses consumed and foreign references', async () => {
  const { api, scopes } = prepareGenerationFixture();
  jest.spyOn(scopes, 'getRunState').mockReturnValue({
    workflowId: 'trusted',
    workflowRunId: 'trusted-run',
    workflowName: 'Trusted',
    spaceId: 'trusted-space',
    admittedChildren: new Set(),
  });
  const first = await api.openGeneration('scope', 'generate', generationInput.api_config);
  const second = await api.openGeneration('scope', 'generate', generationInput.api_config);
  await expect(api.generate('other', first.reference, { sourceAlerts: [] })).rejects.toThrow(
    'Unknown generation reference'
  );
  await expect(api.closeGeneration('other', first.reference)).rejects.toThrow(
    'Unknown generation reference'
  );
  let complete: ((value: GenerationResult) => void) | undefined;
  mockedInvokeGenerationGraph.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  const pending = api.generate('scope', first.reference, { sourceAlerts: [] });
  await expect(api.generate('scope', first.reference, { sourceAlerts: [] })).rejects.toThrow(
    'Generation reference already consumed'
  );
  complete?.({ discoveries: [], replacements: {}, alertsContextCount: 0 });
  await pending;
  await expect(api.generate('scope', first.reference, { sourceAlerts: [] })).rejects.toThrow(
    'Unknown generation reference'
  );
  await api.closeGeneration('scope', second.reference);
  await expect(api.generate('scope', second.reference, { sourceAlerts: [] })).rejects.toThrow(
    'Unknown generation reference'
  );
  const retry = await api.openGeneration('scope', 'generate', generationInput.api_config);
  await api.closeGeneration('scope', retry.reference);
});
it('propagates step cancellation to the original graph and drains references/listeners', async () => {
  const { api, handlerContext, controller } = prepareGenerationFixture();
  const started = Promise.withResolvers<void>();
  mockedInvokeGenerationGraph.mockImplementationOnce(
    ({ abortSignal }) =>
      new Promise((resolve, reject) => {
        started.resolve();
        abortSignal?.addEventListener('abort', () => reject(new Error('Original graph aborted')), {
          once: true,
        });
      })
  );
  const pending = new GenerateStep(api).run('scope', {}, { handlerContext });
  await started.promise;
  controller.abort();
  await expect(pending).rejects.toThrow();
});
it('keeps generation state private to its host even with one reused ScopeLookup', async () => {
  const { api, scopes, getStartServices, logger } = prepareGenerationFixture();
  const otherHost = new AttackDiscoveryOperations(scopes, {
    getStartServices,
    logger,
    connectorTimeout: 60000,
    getEventLogIndex: async () => 'fixture',
    getEventLogger: async () => {
      throw new Error('Unused event logger');
    },
  });
  const { reference } = await api.openGeneration('scope', 'generate', generationInput.api_config);
  await expect(otherHost.generate('scope', reference, { sourceAlerts: [] })).rejects.toThrow(
    'Unknown generation reference'
  );
  await api.closeGeneration('scope', reference);
});

it('keeps original persistence early returns local, including scheduled handover', async () => {
  expect(publicPersistHandler).toBe(createPersistDiscoveriesHandler);
  const { api, handlerContext, getStartServices } = setup();
  const persist = jest.spyOn(api, 'persist');
  handlerContext.input = {
    ...input,
    alerts_context_count: 1,
    anonymized_alerts: [],
    source: 'scheduled',
  };
  await expect(
    new PersistDiscoveriesStep(api).run('scope', {}, { handlerContext })
  ).resolves.toEqual({
    output: {
      discoveries_to_persist: input.attack_discoveries,
      duplicates_dropped_count: 0,
      persisted_discoveries: [],
    },
  });
  handlerContext.input = {
    ...input,
    alerts_context_count: 1,
    anonymized_alerts: [],
    source: undefined,
    attack_discoveries: [],
  };
  await expect(
    new PersistDiscoveriesStep(api).run('scope', {}, { handlerContext })
  ).resolves.toEqual({
    output: { discoveries_to_persist: [], duplicates_dropped_count: 0, persisted_discoveries: [] },
  });
  expect(persist).not.toHaveBeenCalled();
  expect(getStartServices).toHaveBeenCalledTimes(2); // Only the live guard, once per invocation.
});
it('persists through the original scoped rule service with original user, space, and user-authored generation evidence', async () => {
  const { api, handlerContext, esClient, request, pluginsStart } = setup();
  handlerContext.input = {
    ...input,
    alerts_context_count: 1,
    anonymized_alerts: [],
    generation_source: 'explicit-user-producer',
  };
  mockedValidateAttackDiscoveries.mockResolvedValueOnce({
    duplicates_dropped_count: 1,
    validated_discoveries: [],
  });
  await expect(
    new PersistDiscoveriesStep(api).run('scope', {}, { handlerContext })
  ).resolves.toEqual({
    output: {
      discoveries_to_persist: input.attack_discoveries,
      duplicates_dropped_count: 1,
      persisted_discoveries: [],
    },
  });
  expect(pluginsStart.actions.getActionsClientWithRequest).toHaveBeenCalledWith(request);
  expect(mockedValidateAttackDiscoveries).toHaveBeenCalledWith(
    expect.objectContaining({
      esClient,
      spaceId: 'trusted-space',
      authenticatedUser: expect.objectContaining({ username: 'original-user' }),
      generationSource: 'explicit-user-producer',
      validateRequestBody: expect.objectContaining({
        generation_uuid: 'user-evidence',
        connector_name: 'Original connector',
      }),
    })
  );
});
const noAlertsOutcome: Awaited<ReturnType<typeof executeGenerationWorkflow>> = {
  outcome: 'no_alerts',
  alertRetrievalResult: {
    alerts: [],
    alertsContextCount: 0,
    anonymizedAlerts: [],
    apiConfig: { action_type_id: '.gen-ai', connector_id: 'selected' },
    connectorName: 'Original',
    replacements: {},
    workflowExecutions: [],
    workflowId: 'original',
    workflowRunId: 'original-run',
  },
};
const runInput = {
  connector_id: 'selected',
  alerts: ['_id,alert-original'],
  ground_truth_gate_enabled: false,
  include_attack_discoveries: false,
};
const prepareRunFixture = () => {
  const fixture = setup();
  jest.mocked(fixture.scopes.resolveStepType).mockReturnValue('security.attack-discovery.run');
  fixture.handlerContext.input = runInput;
  return fixture;
};
it('shares original run defaults, configuration, omitted output fields and original request', async () => {
  expect(publicRunHandler).toBe(createRunHandler);
  const { api, handlerContext, request } = prepareRunFixture();
  mockedExecuteGenerationWorkflow.mockResolvedValueOnce(noAlertsOutcome);
  const result = await new RunStep(api).run('scope', {}, { handlerContext });
  expect(result).toMatchObject({
    output: { alerts_context_count: 0, discovery_count: 0, status: 'completed' },
  });
  expect(result).not.toHaveProperty('output.attack_discoveries');
  expect(mockedExecuteGenerationWorkflow).toHaveBeenCalledWith(
    expect.objectContaining({
      request,
      alerts: runInput.alerts,
      size: 100,
      trigger: 'workflow',
      type: 'attack_discovery',
      alertsIndexPattern: '.alerts-security.alerts-trusted-space',
      workflowConfig: {
        alert_retrieval_mode: 'custom_query',
        alert_retrieval_workflow_ids: [],
        alert_retrieval_workflows_enabled: false,
        default_retrieval_enabled: false,
        ground_truth_gate_enabled: false,
        skill_enabled: false,
        validation_workflow_id: '',
      },
    })
  );
});
it('keeps original async connector lookup failures inside the handler catch before launching', async () => {
  const { api, handlerContext, getConnector } = prepareRunFixture();
  handlerContext.input = { ...runInput, mode: 'async' };
  mockedExecuteGenerationWorkflow.mockClear();
  getConnector.mockRejectedValueOnce(new Error('Original connector failure'));
  const result = await new RunStep(api).run('scope', {}, { handlerContext });
  expect(result).toMatchObject({
    error: { message: expect.stringContaining('Original connector failure') },
  });
  expect(mockedExecuteGenerationWorkflow).not.toHaveBeenCalled();
});
it('propagates pending run cancellation but detaches after the async step returns, preserving credential lifetime', async () => {
  const { api, handlerContext, scopes, request, esClient, controller } = prepareRunFixture();
  handlerContext.input = { ...runInput, mode: 'async' };
  const stepController = new AbortController();
  handlerContext.abortSignal = stepController.signal;
  const finish = Promise.withResolvers<void>();
  const persisted = Promise.withResolvers<void>();
  let stopProbe: (() => boolean) | undefined;
  mockedExecuteGenerationWorkflow.mockImplementationOnce(async (params) => {
    expect(params.request).toBe(request);
    stopProbe = params.shouldStopExecution;
    await finish.promise;
    expect(params.shouldStopExecution?.()).toBe(false);
    await esClient.index({
      index: 'fixture-original',
      document: { credential: params.request.headers.authorization },
    });
    persisted.resolve();
    return noAlertsOutcome;
  });
  const ports = new MessageChannel();
  openPortSession(ports.port1, expose(api));
  const worker = openPortSession<AttackDiscoveryOperationsApi>(ports.port2);
  try {
    const output = await new RunStep(worker).run('scope', {}, { handlerContext });
    expect(output).toMatchObject({ output: { status: 'pending' } });
    expect(JSON.stringify(output)).not.toMatch(/credential|authorization|ApiKey/);
    // Closing the transport models host disposal after the real scope/lease closes.
    ports.port1.close();
    ports.port2.close();
    controller.abort(new Error('Scope and lease closed'));
    jest.mocked(scopes.get).mockImplementation(() => {
      throw new Error('Closed scope');
    });
    jest.spyOn(scopes, 'getRunState').mockImplementation(() => {
      throw new Error('Closed scope');
    });
    stepController.abort(new Error('Later workflow cancel'));
    await expect(api.cancelRun('scope', 'late-reference')).rejects.toThrow('Closed scope');
    expect(stopProbe?.()).toBe(false);
    finish.resolve();
    await persisted.promise;
    expect(esClient.index).toHaveBeenCalledWith({
      index: 'fixture-original',
      document: { credential: 'ApiKey original-coordinator-run-credential' },
    });
  } finally {
    finish.resolve();
    ports.port1.close();
    ports.port2.close();
    ports.port1.close();
    ports.port2.close();
  }
});
it('cancels original pipeline work while the sync step is still pending and releases all references', async () => {
  const { api, handlerContext, controller } = prepareRunFixture();
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  let stopProbe: (() => boolean) | undefined;
  mockedExecuteGenerationWorkflow.mockImplementationOnce(async (params) => {
    stopProbe = params.shouldStopExecution;
    started.resolve();
    await finish.promise;
    return noAlertsOutcome;
  });
  const pending = new RunStep(api).run('scope', {}, { handlerContext });
  await started.promise;
  controller.abort();
  expect(stopProbe?.()).toBe(true);
  finish.resolve();
  await expect(pending).rejects.toThrow();
});

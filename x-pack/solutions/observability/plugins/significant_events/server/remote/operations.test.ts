/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { MessageChannel } from 'node:worker_threads';
import { expose, openPortSession } from '@kbn/core-remote-common';
import type { ScopeLookup } from '@kbn/core-remote-server';
import {
  elasticsearchServiceMock,
  httpServerMock,
  savedObjectsServiceMock,
  uiSettingsServiceMock,
} from '@kbn/core/server/mocks';
import { inferenceMock } from '@kbn/inference-plugin/server/mocks';
import { loggerMock } from '@kbn/logging-mocks';
import {
  NightshiftModelBlockedError,
  NightshiftModelNotFoundError,
} from '@kbn/significant-events-schema';
import { SignificantEventsOperations } from './operations';
import type { SignificantEventsOperationsApi } from './tokens';
import { restoreSignificantEventsError } from './errors';
import {
  classifyDetectionsStepDefinition,
  type ClassifyDetectionsInput,
} from '../step_definitions/classify_detections';
import { resolveModelStepDefinition } from '../step_definitions/resolve_model';
import { ResolveModelStep } from './resolve_model_step';
import { ClassifyDetectionsStep } from './classify_detections_step';

const input: ClassifyDetectionsInput = {
  rows: [['rule-A']],
  columns: ['rule_uuid'],
  space_id: 'explicit-query-target',
  probe_window_minutes: 30,
  probe_timeout_ms: 1000,
  probe_concurrency: 1,
  budget_ms: 2000,
  max_skip_age_hours: 1,
  review_fresh_minutes: 240,
  baseline_bucket_minutes: 5,
  baseline_window_minutes: 300,
};
const setup = () => {
  const controller = new AbortController();
  const request = httpServerMock.createKibanaRequest();
  const scopes: ScopeLookup = {
    get: jest.fn().mockReturnValue(request),
    getRunState: (scopeId) => {
      if (!['scope', 'other'].includes(scopeId)) throw new Error('Unknown scope');
      return {
        workflowId: 'trusted-workflow',
        workflowName: 'Trusted',
        workflowRunId: 'trusted-run',
        spaceId: 'trusted-space',
        admittedChildren: new Set(),
      };
    },
    getRunDefinitionFacts: jest.fn(),
    getAbortSignal: () => controller.signal,
    resolveStepType: (_scope, stepId) => {
      if (stepId !== 'classify') throw new Error('Unknown step');
      return 'significantEvents.classifyDetections';
    },
    resolveStepOutputLimit: jest.fn(),
    admitChild: jest.fn(),
  };
  const inference = inferenceMock.createStartContract();
  const savedObjects = savedObjectsServiceMock.createStartContract();
  const uiSettings = uiSettingsServiceMock.createStartContract();
  const uiSettingsClient = uiSettingsServiceMock.createClient();
  uiSettings.asScopedToClient.mockReturnValue(uiSettingsClient);
  uiSettingsClient.get.mockResolvedValue(false);
  inference.getConnectorById.mockResolvedValue({ connectorId: 'original-connector' } as never);
  const esClient = elasticsearchServiceMock.createElasticsearchClient();
  esClient.esql.query.mockResponse({ columns: [], values: [] });
  const dependencies = {
    getInference: jest.fn(() => inference),
    getSavedObjects: () => savedObjects,
    getUiSettings: () => uiSettings,
    logger: loggerMock.create(),
    classificationLogger: loggerMock.create(),
    getScopedEsClient: jest.fn(async () => esClient),
  };
  const api = new SignificantEventsOperations(scopes, dependencies);
  return {
    api,
    scopes,
    controller,
    request,
    dependencies,
    inference,
    savedObjects,
    uiSettings,
    uiSettingsClient,
    esClient,
  };
};

it('uses the original model resolver and only the coordinator request for connector/settings policy', async () => {
  const { api, request, inference, savedObjects, dependencies } = setup();
  await expect(
    api.resolveModel('scope', { step: 'discovery', connector_id: ' user-selected ' })
  ).resolves.toBe('original-connector');
  expect(inference.getConnectorById).toHaveBeenCalledWith('user-selected', request);
  expect(savedObjects.getScopedClient).toHaveBeenCalledWith(request);
  const original = resolveModelStepDefinition(dependencies);
  await expect(
    original.handler({
      input: { step: 'discovery', connector_id: ' user-selected ' },
      contextManager: { getFakeRequest: () => request },
    } as never)
  ).resolves.toEqual({ output: { connector_id: 'original-connector' } });
});

it('retains unavailable-before-request ordering in the original default adapter', async () => {
  const { dependencies } = setup();
  const request = jest.fn(() => {
    throw new Error('must not acquire request');
  });
  const definition = resolveModelStepDefinition({ ...dependencies, getInference: () => undefined });
  await expect(
    definition.handler({
      input: { step: 'discovery' },
      contextManager: { getFakeRequest: request },
    } as never)
  ).rejects.toThrow('Significant events model resolution is unavailable');
  expect(request).not.toHaveBeenCalled();
});

it('runs the same original nonempty/empty/fail-open classifier and preserves lazy ES acquisition', async () => {
  const { api, dependencies, esClient } = setup();
  const definition = classifyDetectionsStepDefinition({
    logger: dependencies.classificationLogger,
  });
  const original = await definition.handler({
    input,
    abortSignal: new AbortController().signal,
    contextManager: { getScopedEsClient: () => esClient },
  } as never);
  const reference = await api.openClassification('scope', 'classify');
  await expect(api.classify('scope', reference, input)).resolves.toEqual(original);
  expect(original.output).toMatchObject({
    failed: false,
    needs_agent_count: 1,
    batch: [{ rule_uuid: 'rule-A', classifier: { reason: 'not_live_member' } }],
  });
  expect(dependencies.getScopedEsClient).toHaveBeenCalledWith(expect.anything());
  const empty = await api.openClassification('scope', 'classify');
  await expect(api.classify('scope', empty, { ...input, rows: [] })).resolves.toMatchObject({
    output: { failed: false, row_count: 0 },
  });
  dependencies.getScopedEsClient.mockClear();
  const invalid = await api.openClassification('scope', 'classify');
  await expect(
    api.classify('scope', invalid, { ...input, baseline_bucket_minutes: 60 })
  ).resolves.toMatchObject({ output: { failed: true, row_count: 1 } });
  expect(dependencies.getScopedEsClient).not.toHaveBeenCalled();
});

it('preserves original read failures as fail-open, not RPC failure', async () => {
  const { api, esClient } = setup();
  esClient.esql.query.mockRejectedValue(new Error('original query failure'));
  const reference = await api.openClassification('scope', 'classify');
  await expect(api.classify('scope', reference, input)).resolves.toMatchObject({
    output: { failed: true, row_count: 1 },
  });
});

it('refuses foreign/closed scopes, foreign/single-use references and wrong definition types; permits retries and parallel work', async () => {
  const { api, scopes, controller, dependencies } = setup();
  await expect(api.resolveModel('foreign', { step: 'discovery' })).rejects.toThrow('Unknown scope');
  await expect(api.openClassification('scope', 'missing')).rejects.toThrow('Unknown step');
  jest.spyOn(scopes, 'resolveStepType').mockReturnValueOnce('console');
  await expect(api.openClassification('scope', 'classify')).rejects.toThrow(
    'Not a significant events classification step'
  );
  const reference = await api.openClassification('scope', 'classify');
  await expect(api.classify('other', reference, input)).rejects.toThrow(
    'Unknown classification reference'
  );
  await expect(api.closeClassification('other', reference)).rejects.toThrow(
    'Unknown classification reference'
  );
  await api.classify('scope', reference, input);
  await expect(api.classify('scope', reference, input)).rejects.toThrow(
    'Unknown classification reference'
  );
  const references = await Promise.all([
    api.openClassification('scope', 'classify'),
    api.openClassification('scope', 'classify'),
  ]);
  await expect(
    Promise.all(references.map((ref) => api.classify('scope', ref, input)))
  ).resolves.toHaveLength(2);
  dependencies.getScopedEsClient.mockClear();
  controller.abort();
  await expect(api.openClassification('scope', 'classify')).rejects.toThrow();
  await expect(api.resolveModel('scope', { step: 'discovery' })).rejects.toThrow();
  expect(dependencies.getScopedEsClient).not.toHaveBeenCalled();
});

it('cancels client acquisition through a run-owned single-use reference before ESQL', async () => {
  const { api, dependencies, esClient } = setup();
  const reference = await api.openClassification('scope', 'classify');
  dependencies.getScopedEsClient.mockImplementationOnce(async () => {
    await api.closeClassification('scope', reference);
    return esClient;
  });
  await expect(api.classify('scope', reference, input)).rejects.toThrow();
  expect(esClient.esql.query).not.toHaveBeenCalled();
});

it('restores original public model subclasses/builtin retry types over serialized RPC without private Authorization metadata', async () => {
  const { api, inference } = setup();
  const { port1, port2 } = new MessageChannel();
  try {
    const remote = openPortSession<SignificantEventsOperationsApi>(port1);
    openPortSession(port2, expose(api));
    for (const original of [
      new TypeError('Original failure'),
      new NightshiftModelBlockedError('blocked', 'default'),
      new NightshiftModelNotFoundError('missing'),
    ]) {
      Object.assign(original, { privateAuthorization: 'private-secret' });
      inference.getConnectorById.mockRejectedValueOnce(original);
      try {
        await restoreSignificantEventsError(remote.resolveModel('scope', { step: 'discovery' }));
        throw new Error('Expected failure');
      } catch (error) {
        expect(error).toBeInstanceOf(original.constructor);
        expect(error).toMatchObject({ name: original.name, message: original.message });
        expect(JSON.stringify(error)).not.toContain('private-secret');
      }
      expect(original).toHaveProperty('privateAuthorization', 'private-secret');
    }
    expect(api).not.toHaveProperty('invoke');
  } finally {
    port1.close();
    port2.close();
  }
});

it('requires real executor-local handler context rather than reconstructing a Core or StepContext', async () => {
  const { api } = setup();
  await expect(new ResolveModelStep(api).run('scope', {}, {})).rejects.toThrow(
    'executor-local handler context'
  );
  await expect(new ClassifyDetectionsStep(api).run('scope', {}, {})).rejects.toThrow(
    'executor-local handler context'
  );
});

it('executes both original thin handlers locally and propagates step cancellation to its owned classification', async () => {
  const { api, esClient } = setup();
  const controller = new AbortController();
  const context = {
    input,
    stepId: 'classify',
    abortSignal: controller.signal,
    logger: loggerMock.create(),
  };
  await expect(
    new ResolveModelStep(api).run(
      'scope',
      {},
      { handlerContext: { ...context, input: { step: 'discovery' } } as never }
    )
  ).resolves.toEqual({ output: { connector_id: 'original-connector' } });
  await expect(
    new ClassifyDetectionsStep(api).run('scope', {}, { handlerContext: context as never })
  ).resolves.toMatchObject({ output: { failed: false, row_count: 1 } });
  const close = jest.spyOn(api, 'closeClassification');
  const open = api.openClassification.bind(api);
  jest.spyOn(api, 'openClassification').mockImplementationOnce(async (...args) => {
    const reference = await open(...args);
    controller.abort();
    return reference;
  });
  esClient.esql.query.mockClear();
  await expect(
    new ClassifyDetectionsStep(api).run('scope', {}, { handlerContext: context as never })
  ).rejects.toThrow('Unknown classification reference');
  expect(close).toHaveBeenCalledTimes(1);
  expect(esClient.esql.query).not.toHaveBeenCalled();
});

it('refuses concurrent reuse of a classification reference without refusing legitimate new references', async () => {
  const { api, dependencies, esClient } = setup();
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  dependencies.getScopedEsClient.mockImplementationOnce(async () => {
    await waiting;
    return esClient;
  });
  const reference = await api.openClassification('scope', 'classify');
  const first = api.classify('scope', reference, input);
  try {
    await expect(api.classify('scope', reference, input)).rejects.toThrow(
      'Classification reference already consumed'
    );
  } finally {
    release?.();
  }
  await expect(first).resolves.toMatchObject({ output: { failed: false, row_count: 1 } });
});

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RemoteWorkerSpec } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep, StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { AttackDiscoveryOperationsApi } from '../tokens';

interface Graph {
  spec: RemoteWorkerSpec;
  implementations: Record<string, () => Promise<Record<string, object>>>;
}

const main = async (): Promise<void> => {
  const directory = resolve(process.argv[2]);
  const graph: Graph = await import(pathToFileURL(join(directory, 'graph.mjs')).href);
  for (const root of [graph.spec.root, ...graph.spec.executorProviders, graph.spec.catalog])
    if (root) await graph.implementations[root.modulePath]();
  const sample = (): number => {
    assert(global.gc);
    global.gc();
    return process.memoryUsage().heapUsed;
  };
  const fake = createServer((_request, response) => {
    response.setHeader('x-elastic-product', 'Elasticsearch');
    response.setHeader('content-type', 'application/json');
    response.end(
      _request.url?.includes('_search')
        ? JSON.stringify({ hits: { hits: [{ _id: 'alert-original', _index: 'fixture' }] } })
        : '{"version":{"build_flavor":"default"}}'
    );
  });
  await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done));
  const address = fake.address();
  assert(address && typeof address !== 'string');
  const provider = graph.spec.executorProviders.find(
    ({ tokenId }) => tokenId === 'workflows.dataPlane'
  );
  assert(provider);
  const DataPlane = (await graph.implementations[provider.modulePath]())[
    provider.exportName
  ] as new () => {
    open(scope: string, credentials: object): Promise<void>;
    close(scope: string): Promise<void>;
    internal(scope: string): ReturnType<StepHandlerContext['contextManager']['getScopedEsClient']>;
  };
  const data = new DataPlane();
  try {
    const sdkBefore = sample();
    await data.open('scope', {
      node: `http://127.0.0.1:${address.port}`,
      internalHeaders: { authorization: 'fake' },
      userHeaders: { authorization: 'fake' },
    });
    const esClient = data.internal('scope');
    await esClient.info();
    const sdkHeap = sample() - sdkBefore;
    const contribution = graph.spec.contributions.find(
      ({ stepType }) => stepType === 'security.attack-discovery.defaultValidation'
    );
    assert(contribution);
    const logger = { debug() {}, error() {}, info() {}, warn() {} };
    const handlerContext: StepHandlerContext = {
      input: {
        api_config: { connector_id: 'original', action_type_id: '.gen-ai' },
        generation_uuid: 'fixture-generation',
        attack_discoveries: [
          {
            id: 'original',
            timestamp: '2026-01-01',
            title: 'Original',
            alert_ids: ['alert-original'],
            details_markdown: 'Details',
            summary_markdown: 'Summary',
          },
        ],
      },
      config: {},
      rawInput: {},
      stepId: 'feedback',
      stepType: 'security.attack-discovery.defaultValidation',
      contextManager: {
        getScopedEsClient: () => esClient,
        getContext: () => ({
          workflow: { id: 'fixture-workflow', name: 'Fixture', enabled: true, spaceId: 'default' },
          execution: { id: 'fixture-run', isTestRun: false, startedAt: new Date(), url: '' },
          steps: {},
          kibanaUrl: '',
        }),
        renderInputTemplate: (input) => input,
        getFakeRequest: () => {
          throw new Error('Feedback reads must not need a fake request');
        },
        callKibanaApi: async () => {
          throw new Error('Feedback reads must not proxy Kibana requests');
        },
      },
      logger: { ...logger, info() {}, warn() {} },
      abortSignal: new AbortController().signal,
    };
    const before = sample();
    const started = performance.now();
    const Step = (await graph.implementations[contribution.modulePath]())[
      contribution.exportName
    ] as new (api: AttackDiscoveryOperationsApi) => RemoteWorkflowStep;
    const api: AttackDiscoveryOperationsApi = {
      openRun: async () => {
        throw new Error('Unused run fixture');
      },
      startRun: async () => {
        throw new Error('Unused run fixture');
      },
      finishRun: async () => {},
      cancelRun: async () => {},
      persist: async () => {
        throw new Error('Unused persistence fixture');
      },
      openGeneration: async () => {
        throw new Error('Unused generation fixture');
      },
      generate: async () => {
        throw new Error('Unused generation fixture');
      },
      closeGeneration: async () => {
        throw new Error('Unused generation fixture');
      },
      getRetrievalSpace: async () => {
        throw new Error('Not used in validation');
      },
      openRetrieval: async () => {
        throw new Error('Not used in validation');
      },
      resolveRetrievalConnector: async () => {
        throw new Error('Not used in validation');
      },
      closeRetrieval: async () => {
        throw new Error('Not used in validation');
      },
      checkEnabled: async () => ({
        all: false,
        trace: false,
        debug: false,
        info: true,
        warn: true,
        error: true,
        fatal: true,
        off: false,
      }),
      prepareValidation: async () => ({
        spaceId: 'fixture',
        resolvedConnectorName: 'Original connector',
      }),
      validationDiagnostics: async () => {},
    };
    const result = (await new Step(api).run('scope', {}, { handlerContext })) as {
      output: { filtered_count: number; validated_discoveries: Array<{ id: string }> };
    };
    assert.equal(result.output.filtered_count, 0);
    assert.equal(result.output.validated_discoveries[0].id, 'original');
    process.stdout.write(
      JSON.stringify({
        pid: process.pid,
        sdkHeap,
        heapIncrement: sample() - before,
        ms: performance.now() - started,
      }) + '\n'
    );
  } finally {
    await data.close('scope');
    await new Promise<void>((done) => fake.close(() => done()));
  }
};
main().catch((error: Error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});

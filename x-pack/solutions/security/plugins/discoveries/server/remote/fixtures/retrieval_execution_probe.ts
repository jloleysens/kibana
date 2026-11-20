/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Metafile } from 'esbuild';
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
  const metadata: Metafile = JSON.parse(readFileSync(join(directory, 'metafile.json'), 'utf8'));
  const coreFiles = new Set<string>();
  const closure = (roots: string[]): Set<string> => {
    const files = new Set<string>();
    const visit = (file: string): void => {
      if (files.has(file)) return;
      files.add(file);
      for (const entry of metadata.outputs[file]?.imports ?? [])
        if (entry.kind === 'import-statement' && !entry.external) visit(entry.path);
    };
    for (const root of roots) visit(root);
    return files;
  };
  const sample = (): number => {
    assert(global.gc);
    global.gc();
    return process.memoryUsage().heapUsed;
  };
  for (const root of [graph.spec.root, ...graph.spec.executorProviders, graph.spec.catalog])
    if (root) {
      await graph.implementations[root.modulePath]();
      const output = Object.entries(metadata.outputs).find(
        ([, value]) =>
          value.entryPoint === root.modulePath ||
          Object.keys(value.inputs).some((input) => resolve(input) === root.modulePath)
      );
      assert(output);
      for (const file of closure([output[0]])) coreFiles.add(file);
    }
  const injectEntry = graph.spec.contributions.find(
    (x) => x.stepType === 'esqlParser.injectMetadataId'
  );
  const correctEntry = graph.spec.contributions.find(
    (x) => x.stepType === 'esqlParser.correctQueryWithAst'
  );
  assert(injectEntry && correctEntry);
  const beforeParser = sample();
  const parserStarted = performance.now();
  const injectModule = await graph.implementations[injectEntry.modulePath]();
  const injectMetadataId = injectModule.injectMetadataId as (query: string) => string;
  assert.equal(
    injectMetadataId('FROM fixture | KEEP message'),
    'FROM fixture METADATA _id | KEEP message, _id'
  );
  const correctModule = await graph.implementations[correctEntry.modulePath]();
  const correctQueryWithAst = correctModule.correctQueryWithAst as (query: string) => {
    output: string;
    corrections: object[];
  };
  const corrected = correctQueryWithAst(
    'FROM fixture | EVAL rounded = DATE_TRUNC("1 year", @timestamp)'
  );
  assert.equal(corrected.output, 'FROM fixture | EVAL rounded = DATE_TRUNC("1 year", @timestamp)');
  assert.equal(corrected.corrections.length, 0);
  const parserMs = performance.now() - parserStarted;
  const parserHeap = sample() - beforeParser;
  const parserOutputs = Object.entries(metadata.outputs)
    .filter(([, value]) =>
      [injectEntry.modulePath, correctEntry.modulePath].includes(resolve(value.entryPoint ?? ''))
    )
    .map(([file]) => file);
  assert.equal(parserOutputs.length, 2);
  const parserFiles = closure(parserOutputs);
  const parserBytes = [...parserFiles]
    .filter((file) => !coreFiles.has(file))
    .reduce((sum, file) => sum + metadata.outputs[file].bytes, 0);
  let query = '';
  let esqlCalls = 0;
  let searchCalls = 0;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    response.setHeader('x-elastic-product', 'Elasticsearch');
    response.setHeader('content-type', 'application/json');
    if (request.url?.includes('_query')) {
      esqlCalls++;
      query = JSON.parse(body).query;
      response.end(
        JSON.stringify({
          columns: [
            { name: 'message', type: 'keyword' },
            { name: '_id', type: 'keyword' },
          ],
          values: [['Original message', 'original-alert']],
        })
      );
    } else if (request.url?.includes('_search')) {
      searchCalls++;
      response.end(
        JSON.stringify({
          hits: {
            hits: [
              {
                _id: 'original-alert',
                fields: { message: ['Original message'], _id: ['original-alert'] },
              },
            ],
          },
        })
      );
    } else response.end('{"version":{"build_flavor":"default"}}');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const provider = graph.spec.executorProviders.find((x) => x.tokenId === 'workflows.dataPlane');
  assert(provider);
  const Data = (await graph.implementations[provider.modulePath]())[
    provider.exportName
  ] as new () => {
    open(scope: string, credentials: object): Promise<void>;
    close(scope: string): Promise<void>;
    internal(scope: string): ReturnType<StepHandlerContext['contextManager']['getScopedEsClient']>;
  };
  const data = new Data();
  try {
    const sdkBefore = sample();
    await data.open('scope', {
      node: 'http://127.0.0.1:' + address.port,
      internalHeaders: { authorization: 'fake' },
      userHeaders: { authorization: 'fake' },
    });
    const esClient = await data.internal('scope');
    await esClient.info();
    const sdkHeap = sample() - sdkBefore;
    const api: AttackDiscoveryOperationsApi = {
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
      getRetrievalSpace: async () => 'fixture',
      openRetrieval: async () => 'reference',
      closeRetrieval: async () => {},
      resolveRetrievalConnector: async () => ({ connectorName: 'Original connector' }),
      prepareValidation: async () => {
        throw new Error('Not validation');
      },
      validationDiagnostics: async () => {
        throw new Error('Not validation');
      },
    };
    const contribution = graph.spec.contributions.find(
      (x) => x.stepType === 'security.attack-discovery.defaultAlertRetrieval'
    );
    assert(contribution);
    const before = sample();
    const started = performance.now();
    const Step = (await graph.implementations[contribution.modulePath]())[
      contribution.exportName
    ] as new (api: AttackDiscoveryOperationsApi) => RemoteWorkflowStep;
    const input = {
      esql_query: 'FROM fixture | KEEP message',
      alerts_index_pattern: 'fixture',
      size: 10,
      anonymization_fields: [{ id: 'message', field: 'message', allowed: true, anonymized: false }],
      api_config: { connector_id: '', action_type_id: '' },
    };
    const handlerContext: StepHandlerContext = {
      input,
      config: {},
      rawInput: {},
      stepId: 'retrieve',
      stepType: 'security.attack-discovery.defaultAlertRetrieval',
      contextManager: {
        getScopedEsClient: () => esClient,
        getContext: () => {
          throw new Error('No worker identity');
        },
        getFakeRequest: () => {
          throw new Error('No coordinator request');
        },
        renderInputTemplate: (value) => value,
        callKibanaApi: async () => {
          throw new Error('No Kibana proxy');
        },
      },
      logger: {
        info() {},
        debug() {},
        warn() {},
        error(message, error) {
          throw error ?? new Error(message);
        },
      },
      abortSignal: new AbortController().signal,
    };
    const result = (await new Step(api).run('scope', {}, { handlerContext })) as {
      output: { alerts_context_count: number; alerts: string[] };
    };
    assert.equal(result.output.alerts_context_count, 1);
    assert.match(result.output.alerts[0], /original-alert/);
    assert.match(result.output.alerts[0], /Original message/);
    assert.equal(query, 'FROM fixture METADATA _id | KEEP message, _id');
    assert.equal(esqlCalls, 1);
    const retrievalMs = performance.now() - started;
    const retrievalHeap = sample() - before;
    handlerContext.input = { ...input, esql_query: undefined };
    await new Step(api).run('scope', {}, { handlerContext });
    assert.equal(searchCalls, 1);
    process.stdout.write(
      JSON.stringify({
        pid: process.pid,
        parserHeap,
        parserBytes,
        parserMs,
        sdkHeap,
        retrievalHeap,
        retrievalMs,
        esqlCalls,
        searchCalls,
      }) + '\n'
    );
  } finally {
    await data.close('scope');
    await new Promise<void>((done) => server.close(() => done()));
  }
};
main().catch((error: Error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});

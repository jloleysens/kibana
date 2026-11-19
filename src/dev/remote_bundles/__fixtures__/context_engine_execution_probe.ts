/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RemoteWorkerSpec } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep, StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { FeedbackOperationsApi } from '@kbn/context-engine-plugin/server/remote/feedback_tokens';

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
    response.end('{"version":{"build_flavor":"default"}}');
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
      ({ stepType }) => stepType === 'context-engine.getFeedbackContext'
    );
    assert(contribution);
    const logger = { debug() {}, error() {}, info() {}, warn() {} };
    const handlerContext: StepHandlerContext = {
      input: { ai_index_id: 'fixture' },
      config: {},
      rawInput: {},
      stepId: 'feedback',
      stepType: 'context-engine.getFeedbackContext',
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
    const events = [];
    for (const hasSignals of [true, false]) {
      const before = sample();
      const started = performance.now();
      const Step = (await graph.implementations[contribution.modulePath]())[
        contribution.exportName
      ] as new (api: FeedbackOperationsApi) => RemoteWorkflowStep;
      let calls = 0;
      const operations: FeedbackOperationsApi = {
        isContextEngineEnabled: async () => true,
        isFeedbackLoopEnabled: async () => true,
        buildContext: async (scopeId, aiIndexId) => {
          calls++;
          assert.equal(scopeId, 'scope');
          assert.equal(aiIndexId, 'fixture');
          return {
            outcome: 'success',
            context: {
              agent_id: 'original-agent',
              briefing: 'Original service response',
              output_schema: {},
              has_signals: hasSignals,
              run: {
                signal_count: hasSignals ? 1 : 0,
                signal_spaces: hasSignals ? ['default'] : [],
                signal_window: { from: '2026-01-01', to: '2026-02-01' },
              },
            },
          };
        },
      };
      const result = (await new Step(operations).run('scope', {}, { handlerContext })) as {
        output: { has_signals: boolean; signal_count: number; briefing: string };
      };
      const ms = performance.now() - started;
      const heapIncrement = sample() - before;
      assert.equal(calls, 1);
      assert.equal(result.output.has_signals, hasSignals);
      assert.equal(result.output.signal_count, hasSignals ? 1 : 0);
      assert.equal(result.output.briefing, 'Original service response');
      events.push({ hasSignals, ms, heapIncrement });
    }
    process.stdout.write(`${JSON.stringify({ sdkHeap, events })}\n`);
  } finally {
    await data.close('scope');
    await new Promise<void>((done) => fake.close(() => done()));
  }
};
main().catch((error: Error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RemoteWorkerSpec } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep, StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { KiOperationsApi } from '@kbn/context-engine-plugin/server/remote/ki_tokens';
import type { FeedbackOperationsApi } from '@kbn/context-engine-plugin/server/remote/feedback_tokens';

const main = async (): Promise<void> => {
  const directory = resolve(process.argv[2]);
  const graph: {
    spec: RemoteWorkerSpec;
    implementations: Record<string, () => Promise<Record<string, object>>>;
  } = await import(pathToFileURL(join(directory, 'graph.mjs')).href);
  for (const root of [graph.spec.root, ...graph.spec.executorProviders, graph.spec.catalog])
    if (root) await graph.implementations[root.modulePath]();
  const sample = (): number => {
    assert(global.gc);
    global.gc();
    return process.memoryUsage().heapUsed;
  };
  let source = { title: 'Before' };
  let calls = 0;
  const api: KiOperationsApi = {
    cancelWrite: async () => {},
    openVerification: async () => 'verification',
    cancelVerification: async () => {},
    assertEnabled: async () => {},
    openWrite: async () => 'write',
    authorizeWrite: async () => {},
    resolve: async () => ({ dest: { type: 'index', value: 'fixture' }, managed: false }),
    readRevision: async () => ({
      reference: 'revision',
      revision: { index: 'fixture', documentId: 'ki', source: structuredClone(source) },
    }),
    writeRevision: async (_scope, _write, _revision, changes) => {
      calls++;
      source = { ...source, ...changes };
      return { result: 'updated' };
    },
    putRevision: async () => {
      calls++;
    },
    finishWrite: async () => {},
    verify: async () => ({ passed: true, results: [{ verifier: 'fixture', passed: true }] }),
  };
  const settings: FeedbackOperationsApi = {
    isContextEngineEnabled: async () => true,
    isFeedbackLoopEnabled: async () => true,
    buildContext: async () => {
      throw new Error('Unused');
    },
  };
  const events = [];
  for (const [action, input] of [
    [
      'createKi',
      {
        ai_index_id: 'fixture',
        ki_id: 'ki',
        ki: { type: 'document', title: 'Original', attributes: { omit: null, keep: 'value' } },
      },
    ],
    ['updateKi', { ai_index_id: 'fixture', ki_id: 'ki', ki: { title: 'After' } }],
    ['deleteKi', { ai_index_id: 'fixture', ki_id: 'ki' }],
    ['verifyKi', { ki: { type: 'document', title: 'Original' } }],
  ] as const) {
    if (process.argv[3] && process.argv[3] !== action) continue;
    const contribution = graph.spec.contributions.find(
      ({ stepType }) => stepType === 'context-engine.' + action
    );
    assert(contribution);
    const before = sample();
    const started = performance.now();
    const Step = (await graph.implementations[contribution.modulePath]())[
      contribution.exportName
    ] as new (api: KiOperationsApi, settings: FeedbackOperationsApi) => RemoteWorkflowStep;
    const handlerContext: StepHandlerContext = {
      input,
      config: {},
      rawInput: {},
      stepId: action,
      stepType: 'context-engine.' + action,
      contextManager: {
        callKibanaApi: async () => {
          throw new Error('KI handlers must not proxy Kibana requests');
        },
        getScopedEsClient: () => {
          throw new Error('Final writes must not use worker ES');
        },
        getContext: () => {
          throw new Error('KI handlers must not construct provenance from worker context');
        },
        getFakeRequest: () => {
          throw new Error('KI handlers must not fake requests');
        },
        renderInputTemplate: (value) => value,
      },
      logger: { debug() {}, error() {}, info() {}, warn() {} },
      abortSignal: new AbortController().signal,
    };
    const result = await new Step(api, settings).run('scope', {}, { handlerContext });
    const ms = performance.now() - started;
    const heapIncrement = sample() - before;
    assert.deepEqual(
      result,
      action === 'verifyKi'
        ? { output: { passed: true, results: [{ verifier: 'fixture', passed: true }] } }
        : action === 'updateKi'
        ? { output: { id: 'ki', result: 'updated' } }
        : { output: { id: 'ki' } }
    );
    events.push({ action, ms, heapIncrement });
  }
  assert.equal(calls, process.argv[3] ? (process.argv[3] === 'verifyKi' ? 0 : 1) : 3);
  process.stdout.write(JSON.stringify({ events }) + '\n');
};
main().catch((error: Error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});

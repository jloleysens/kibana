/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RemoteWorkflowStep, StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { AlertEventDocument } from '../../resources/datastreams/alert_events';
import type { AlertEventStorageApi } from '../tokens';

const main = async (): Promise<void> => {
  const graph = await import(pathToFileURL(resolve(process.argv[2], 'graph.mjs')).href);
  for (const root of [graph.spec.root, ...graph.spec.executorProviders, graph.spec.catalog])
    if (root) await graph.implementations[root.modulePath]();
  const sample = (): number => {
    assert(global.gc);
    global.gc();
    return process.memoryUsage().heapUsed;
  };
  const contribution = graph.spec.contributions.find(
    (entry: { stepType: string }) => entry.stepType === 'alerting.create_alert'
  );
  assert(contribution);
  const persisted: AlertEventDocument[] = [];
  const api: AlertEventStorageApi = {
    canWrite: async (scopeId) => {
      assert.equal(scopeId, 'scope');
      return true;
    },
    parse: async (scopeId, value) => {
      assert.equal(scopeId, 'scope');
      return value as Awaited<ReturnType<AlertEventStorageApi['parse']>>;
    },
    open: async (scopeId) => {
      assert.equal(scopeId, 'scope');
      return { reference: 'series', spaceId: 'space-a' };
    },
    readLatest: async (scopeId, reference, event) => {
      assert.equal(scopeId, 'scope');
      assert.equal(reference, 'series');
      assert.equal(event.fingerprint, 'fp-1');
      assert.equal('space_id' in event, false);
      return [];
    },
    persist: async (scopeId, reference, doc) => {
      assert.equal(scopeId, 'scope');
      assert.equal(reference, 'series');
      persisted.push(doc);
    },
    close: async (scopeId, reference) => {
      assert.equal(scopeId, 'scope');
      assert.equal(reference, 'series');
    },
  };
  const handlerContext: StepHandlerContext = {
    input: { source: 'datadog', fingerprint: 'fp-1', alert_status: 'active' },
    config: {},
    rawInput: {},
    stepId: 'create-alert',
    stepType: 'alerting.create_alert',
    contextManager: {
      getContext: () => {
        throw new Error('Alert creation must not read worker workflow context');
      },
      renderInputTemplate: (value) => value,
      getFakeRequest: () => {
        throw new Error('Alert creation must not read a worker request');
      },
      getScopedEsClient: () => {
        throw new Error('Alert creation must not open a worker ES client');
      },
      callKibanaApi: async () => {
        throw new Error('Alert creation must not proxy Kibana requests');
      },
    },
    logger: { debug() {}, error() {}, info() {}, warn() {} },
    abortSignal: new AbortController().signal,
  };
  const before = sample();
  const started = performance.now();
  const Step = (await graph.implementations[contribution.modulePath]())[
    contribution.exportName
  ] as new (storage: AlertEventStorageApi) => RemoteWorkflowStep;
  const result = (await new Step(api).run('scope', {}, { handlerContext })) as {
    output: { group_hash: string; alert_id: string };
  };
  const groupHash = createHash('sha256').update('space-a:datadog:fp-1').digest('hex');
  assert.equal(result.output.group_hash, groupHash);
  assert.match(result.output.alert_id, /^[0-9a-f-]{36}$/);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].space_id, 'space-a');
  assert.equal(persisted[0].group_hash, groupHash);
  assert.equal(persisted[0].status, 'breached');
  assert.equal(persisted[0].type, 'alert');
  assert.equal(persisted[0].alert.status, 'active');
  assert.equal(persisted[0].alert.id, result.output.alert_id);
  process.stdout.write(
    `${JSON.stringify({
      pid: process.pid,
      heapIncrement: sample() - before,
      ms: performance.now() - started,
    })}\n`
  );
};

main().catch((error: Error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});

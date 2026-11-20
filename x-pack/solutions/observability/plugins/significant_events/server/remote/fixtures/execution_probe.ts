/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RemoteWorkerSpec } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep, StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { SignificantEventsOperationsApi } from '../tokens';

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
  const output = {
    batch: [{ rule_uuid: 'original' }],
    row_count: 1,
    skipped_rule_uuids: [],
    skips: [],
    skipped_count: 0,
    held_back_count: 0,
    needs_agent_count: 1,
    reason_counts: {},
    probe_status_counts: {},
    skipped_detection_ids: [],
    failed: false,
  };
  const api: SignificantEventsOperationsApi = {
    resolveModel: async () => 'original-model',
    openClassification: async () => 'reference',
    closeClassification: async () => {},
    classify: async () => ({ output }),
  };
  const action = process.argv[3];
  const entry = graph.spec.contributions.find(
    ({ stepType }) => stepType === 'significantEvents.' + action
  );
  assert(entry);
  const before = sample();
  const started = performance.now();
  const Step = (await graph.implementations[entry.modulePath]())[entry.exportName] as new (
    api: SignificantEventsOperationsApi
  ) => RemoteWorkflowStep;
  const handlerContext: StepHandlerContext = {
    input:
      action === 'resolveModel'
        ? { step: 'discovery' }
        : {
            rows: [['original']],
            columns: ['rule_uuid'],
            space_id: 'fixture',
            probe_window_minutes: 30,
            probe_timeout_ms: 1000,
            probe_concurrency: 1,
            budget_ms: 2000,
            max_skip_age_hours: 1,
            review_fresh_minutes: 240,
            baseline_bucket_minutes: 5,
            baseline_window_minutes: 300,
          },
    config: {},
    rawInput: {},
    stepId: 'classify',
    stepType: 'significantEvents.' + action,
    contextManager: {
      callKibanaApi: async () => {
        throw new Error('No Kibana proxy');
      },
      getScopedEsClient: () => {
        throw new Error('No worker ES for coordinator reads');
      },
      getContext: () => {
        throw new Error('No worker provenance');
      },
      getFakeRequest: () => {
        throw new Error('No fake coordinator request');
      },
      renderInputTemplate: (value) => value,
    },
    logger: { debug() {}, error() {}, info() {}, warn() {} },
    abortSignal: new AbortController().signal,
  };
  const result = await new Step(api).run('scope', {}, { handlerContext });
  assert.deepEqual(result, {
    output: action === 'resolveModel' ? { connector_id: 'original-model' } : output,
  });
  process.stdout.write(
    JSON.stringify({
      pid: process.pid,
      action,
      heapIncrement: sample() - before,
      ms: performance.now() - started,
    }) + '\n'
  );
};
main().catch((error: Error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});

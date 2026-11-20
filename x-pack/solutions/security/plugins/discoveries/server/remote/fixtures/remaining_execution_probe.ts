/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RemoteWorkflowStep, StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { AttackDiscoveryOperationsApi } from '../tokens';

const main = async () => {
  const graph = await import(pathToFileURL(resolve(process.argv[2], 'graph.mjs')).href);
  for (const root of [graph.spec.root, ...graph.spec.executorProviders, graph.spec.catalog])
    if (root) await graph.implementations[root.modulePath]();
  const sample = () => {
    global.gc?.();
    return process.memoryUsage().heapUsed;
  };
  const action = process.argv[3] ?? 'generate';
  const contribution = graph.spec.contributions.find(
    (entry: { stepType: string }) => entry.stepType === 'security.attack-discovery.' + action
  );
  const unused = async () => {
    throw new Error('Unused generation fixture operation');
  };
  const api: AttackDiscoveryOperationsApi = {
    openRun: async () => ({
      reference: 'original-ref',
      executionUuid: 'original-run',
      effectiveConnectorId: 'original',
    }),
    startRun: async () => ({
      outcome: 'no_alerts',
      alertRetrievalResult: {
        alerts: [],
        alertsContextCount: 0,
        anonymizedAlerts: [],
        apiConfig: { action_type_id: '.gen-ai', connector_id: 'original' },
        connectorName: 'Original',
        replacements: {},
        workflowExecutions: [],
        workflowId: 'original',
        workflowRunId: 'original-run',
      },
    }),
    finishRun: async () => {},
    cancelRun: async () => {},
    persist: async () => ({ duplicates_dropped_count: 0, validated_discoveries: [] }),
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
    openGeneration: async () => ({ reference: 'original-ref', executionUuid: 'original-run' }),
    generate: async () => ({
      discoveries: [
        {
          alertIds: ['original-alert'],
          title: 'Original',
          detailsMarkdown: 'Details',
          summaryMarkdown: 'Summary',
        },
      ],
      replacements: { masked: 'Original' },
      alertsContextCount: 1,
    }),
    closeGeneration: async () => {},
    getRetrievalSpace: unused,
    openRetrieval: unused,
    resolveRetrievalConnector: unused,
    closeRetrieval: unused,
    prepareValidation: unused,
    validationDiagnostics: async () => {},
  };
  const handlerContext: StepHandlerContext = {
    input: {
      alerts: ['_id,original-alert'],
      api_config: { connector_id: 'original', action_type_id: '.gen-ai' },
      connector_id: 'original',
      include_attack_discoveries: false,
      attack_discoveries: [
        {
          id: 'original',
          title: 'Original',
          alert_ids: ['original-alert'],
          details_markdown: 'Details',
          summary_markdown: 'Summary',
        },
      ],
      generation_uuid: 'original-evidence',
      alerts_context_count: 1,
      anonymized_alerts: [],
    },
    config: {},
    rawInput: {},
    stepType: 'security.attack-discovery.generate',
    contextManager: {
      getContext: () => ({
        workflow: { id: 'original-workflow', name: 'Original', enabled: true, spaceId: 'default' },
        execution: { id: 'original-run', isTestRun: false, startedAt: new Date(), url: '' },
        steps: {},
        kibanaUrl: '',
      }),
      renderInputTemplate: (input) => input,
      getFakeRequest: () => {
        throw new Error('No request in fixture');
      },
      getScopedEsClient: () => {
        throw new Error('No native ES in generation');
      },
      callKibanaApi: async () => {
        throw new Error('No native HTTP in generation');
      },
    },
    stepId: 'generate',
    abortSignal: new AbortController().signal,
    logger: { info() {}, error() {}, warn() {}, debug() {} },
  };
  const before = sample();
  const started = performance.now();
  const Step = (await graph.implementations[contribution.modulePath]())[
    contribution.exportName
  ] as new (operations: AttackDiscoveryOperationsApi) => RemoteWorkflowStep;
  const result = await new Step(api).run('scope', {}, { handlerContext });
  if (action === 'generate')
    assert.deepEqual(result, {
      output: {
        attack_discoveries: [
          {
            alert_ids: ['original-alert'],
            details_markdown: 'Details',
            entity_summary_markdown: undefined,
            id: 'original-run-0',
            mitre_attack_tactics: undefined,
            summary_markdown: 'Summary',
            timestamp: undefined,
            title: 'Original',
          },
        ],
        execution_uuid: 'original-run',
        replacements: { masked: 'Original' },
      },
    });
  else if (action === 'persistDiscoveries')
    assert.deepEqual(result, {
      output: {
        discoveries_to_persist: [
          {
            id: 'original',
            title: 'Original',
            alert_ids: ['original-alert'],
            details_markdown: 'Details',
            summary_markdown: 'Summary',
          },
        ],
        duplicates_dropped_count: 0,
        persisted_discoveries: [],
      },
    });
  else
    assert.deepEqual(result, {
      output: {
        alerts_context_count: 0,
        discovery_count: 0,
        execution_uuid: 'original-run',
        status: 'completed',
      },
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

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Metafile } from 'esbuild';
import type { KibanaRequest, Logger } from '@kbn/core/server';
import type { RemoteWorkerSpec } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep, StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { InferencePolicy } from '@kbn/inference-plugin/server/remote/tokens';
import type { WorkflowDataPlaneApi } from '@kbn/workflows-execution-engine/server/remote/tokens';

type Implementation = typeof import('@kbn/inference-plugin/server/remote/worker_inference');
interface Graph {
  spec: RemoteWorkerSpec;
  implementations: Record<string, () => Promise<Record<string, object>>>;
}

const main = async (): Promise<void> => {
  const directory = resolve(process.argv[2]);
  const graph: Graph = await import(pathToFileURL(join(directory, 'graph.mjs')).href);
  const metadata: Metafile = JSON.parse(readFileSync(join(directory, 'metafile.json'), 'utf8'));
  let requests = 0;
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    response.setHeader('x-elastic-product', 'Elasticsearch');
    response.setHeader('content-type', 'application/json');
    if (request.method === 'GET') {
      response.end(
        JSON.stringify(
          request.url?.startsWith('/_inference/_services')
            ? [{ service: 'openai', features: { non_streaming_chat: { supported: true } } }]
            : {
                endpoints: [
                  {
                    inference_id: 'endpoint',
                    task_type: 'chat_completion',
                    service: 'openai',
                    service_settings: { model_id: 'gpt-4o' },
                  },
                ],
              }
        )
      );
      return;
    }
    if (request.url?.includes('ai-index-idx-nightshift-')) {
      response.end(JSON.stringify({ hits: { hits: [], total: { value: 0 } } }));
      return;
    }
    requests++;
    const body = JSON.parse(text);
    const tool = body.tools?.[0]?.function;
    const message = tool
      ? {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'local',
              type: 'function',
              function: {
                name: tool.name,
                arguments: JSON.stringify(
                  tool.parameters?.properties?.edits
                    ? { edits: [] }
                    : tool.parameters?.properties?.extractions
                    ? { extractions: [] }
                    : tool.name === 'classify'
                    ? { category: 'Security' }
                    : { response: { verified: true } }
                ),
              },
            },
          ],
        }
      : { role: 'assistant', content: 'Verified local inference response' };
    response.end(
      JSON.stringify({
        id: 'local',
        object: 'chat.completion',
        model: 'gpt-4o',
        created: 1,
        choices: [{ index: 0, message, finish_reason: tool ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
      })
    );
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  for (const root of [graph.spec.root, ...graph.spec.executorProviders, graph.spec.catalog])
    if (root) await graph.implementations[root.modulePath]();
  const dataProvider = graph.spec.executorProviders.find(
    ({ tokenId }) => tokenId === 'workflows.dataPlane'
  );
  assert(dataProvider);
  const { ExecutorDataPlane } = (await graph.implementations[dataProvider.modulePath]()) as {
    ExecutorDataPlane: new () => WorkflowDataPlaneApi;
  };
  const data = new ExecutorDataPlane();
  await data.open('scope', {
    node: `http://127.0.0.1:${address.port}`,
    internalHeaders: { authorization: 'ApiKey local-fake' },
    userHeaders: { authorization: 'ApiKey local-fake-user' },
  });
  const sample = () => {
    assert(global.gc);
    global.gc();
    return process.memoryUsage();
  };
  try {
    const before = sample();
    const started = performance.now();
    const entry = Object.entries(metadata.outputs).find(([, output]) =>
      output.entryPoint?.endsWith('/remote/worker_inference.ts')
    );
    const parser = Object.entries(metadata.outputs).find(([, output]) =>
      output.entryPoint?.endsWith('/utils/parse_max_step_size.ts')
    );
    assert(entry && parser);
    const closure = (files: string[]): Set<string> => {
      const seen = new Set<string>();
      const visit = (file: string) => {
        if (seen.has(file)) return;
        seen.add(file);
        for (const imported of metadata.outputs[file].imports)
          if (!imported.external && imported.kind !== 'dynamic-import') visit(imported.path);
      };
      files.forEach(visit);
      return seen;
    };
    const core = closure(
      Object.entries(metadata.outputs)
        .filter(
          ([, output]) =>
            [graph.spec.root, ...graph.spec.executorProviders, graph.spec.catalog].some(
              (provider) =>
                provider && output.entryPoint && resolve(output.entryPoint) === provider.modulePath
            ) || output.entryPoint === 'node_modules/@elastic/elasticsearch/esm/index.js'
        )
        .map(([file]) => file)
    );
    const sharedFiles = closure([entry[0], parser[0]]);
    const sharedBytes = [...sharedFiles]
      .filter((file) => !core.has(file))
      .reduce((bytes, file) => bytes + metadata.outputs[file].bytes, 0);
    const implementation: Implementation = await import(pathToFileURL(resolve(entry[0])).href);
    await import(pathToFileURL(resolve(parser[0])).href);
    const policy: InferencePolicy = {
      namespace: 'default',
      rules: [],
      onFailure: 'block',
      defaultConnector: 'endpoint',
      defaultOnly: false,
      streaming: false,
      tokenUsageTracking: false,
      regexWorkerEnabled: true,
      stackConnectors: [],
    };
    const policyApi = { read: async () => policy, runRegexRules: async () => [] };
    const logger: Logger = {
      get: () => logger,
      log() {},
      trace() {},
      info() {},
      debug() {},
      warn() {},
      error() {},
      fatal() {},
      isLevelEnabled: () => false,
    };
    const request = {} as KibanaRequest;
    const inference = implementation.createWorkerInference({
      scopeId: 'scope',
      policy,
      capability: policyApi,
      internalClient: data.internal('scope'),
      userClient: data.user('scope'),
      logger,
    });
    const model = await inference.getChatModel({
      request,
      connectorId: 'endpoint',
      chatModelOptions: { maxRetries: 0 },
    });
    assert.equal(
      (await model.invoke('A local inference business record')).content,
      'Verified local inference response'
    );
    const sharedMs = performance.now() - started;
    const shared = sample();
    const events = [];
    for (const [type, input, expected] of [
      [
        'ai.prompt',
        { prompt: 'A local inference business record' },
        { content: 'Verified local inference response' },
      ],
      [
        'ai.prompt',
        {
          prompt: 'Return verified JSON',
          schema: { type: 'object', properties: { verified: { type: 'boolean' } } },
        },
        { content: { verified: true } },
      ],
      [
        'ai.summarize',
        { input: 'A local inference business record' },
        { content: 'Verified local inference response' },
      ],
      [
        'ai.classify',
        { input: 'A security incident', categories: ['Security', 'Other'] },
        { category: 'Security' },
      ],
      ...(process.argv.includes('--optimizers')
        ? ([
            [
              'nightshift.cortexOptimize',
              {
                agent_id: 'nightshift.investigation',
                connector_id: 'endpoint',
                prompt: 'Investigate local record',
                response: 'Observed saturation',
                tool_calls: [0, 1, 2].map((index) => ({
                  tool_id: 'nightshift_sandbox_bash',
                  tool_call_id: 'read-' + index,
                  params: { command: 'cat /tmp/evidence' },
                })),
                tool_results: [0, 1, 2].map((index) => ({
                  tool_call_id: 'read-' + index,
                  results: [{ type: 'other', data: { stdout: 'Nonempty verified evidence' } }],
                })),
              },
              { status: 'ok' },
            ],
            [
              'nightshift.memoryOptimize',
              {
                agent_id: 'nightshift.investigation',
                connector_id: 'endpoint',
                prompt: 'Investigate local record',
                response: 'Observed saturation',
                tool_calls: [0, 1, 2].map((index) => ({
                  tool_id: 'nightshift_sandbox_bash',
                  tool_call_id: 'read-' + index,
                  params: { command: 'cat /tmp/evidence' },
                })),
                tool_results: [0, 1, 2].map((index) => ({
                  tool_call_id: 'read-' + index,
                  results: [{ type: 'other', data: { stdout: 'Nonempty verified evidence' } }],
                })),
              },
              { status: 'ok' },
            ],
          ] as const)
        : []),
    ] as const) {
      const start = sample();
      const count = requests;
      const time = performance.now();
      const contribution = graph.spec.contributions.find(({ stepType }) => stepType === type);
      assert(contribution);
      const loaded = await graph.implementations[contribution.modulePath]();
      const Ctor = loaded[contribution.exportName] as new (...args: object[]) => RemoteWorkflowStep;
      const step = type.startsWith('nightshift.')
        ? new Ctor(
            {
              enabled: async () => true,
              log: async () => {},
              prepareModel: async () => 'endpoint',
              reportCortex: async () => {},
              reportMemory: async () => {},

              open: async () => ({
                lease: 'completion',
                metadata: { pluginId: 'nightshift.investigation_memory', interactionId: 'run' },
              }),
              report: async () => {},
              settle: async () => {},
            },

            {},
            policyApi,
            {
              list: async () => [],
              getForFeature: async () => {
                throw new Error('Unexpected endpoint resolution');
              },
            },
            data,
            {}
          )
        : new Ctor(
            policyApi,
            {
              list: async () => [],
              getForFeature: async () => {
                throw new Error('Unexpected feature read');
              },
            },
            data
          );
      const context: StepHandlerContext = {
        input,
        rawInput: input,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        stepId: type,
        stepType: type,
        config: { 'connector-id': 'endpoint' },
        abortSignal: new AbortController().signal,
        contextManager: {
          getFakeRequest: () => request,
          getContext: () =>
            ({
              execution: { id: 'run' },
              workflow: { id: 'workflow', spaceId: 'default' },
            } as ReturnType<StepHandlerContext['contextManager']['getContext']>),
          getScopedEsClient: () => data.user('scope'),
          renderInputTemplate: <T>(value: T): T => value,
          callKibanaApi: async () => {
            throw new Error('Inference must not proxy LLM calls through Kibana');
          },
        },
      };
      const result = (await step.run('scope', {}, { handlerContext: context })) as {
        output: Record<string, object | string>;
      };
      for (const [key, value] of Object.entries(expected))
        assert.deepEqual(result.output[key], value);
      const end = sample();
      events.push({
        type,
        heapIncrement: end.heapUsed - start.heapUsed,
        ms: performance.now() - time,
        requests: requests - count,
      });
    }
    process.stdout.write(
      JSON.stringify({
        sharedBytes,
        sharedHeap: shared.heapUsed - before.heapUsed,
        sharedMs,
        events,
        requests,
      })
    );
  } finally {
    await data.close('scope');
    await new Promise<void>((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose()))
    );
  }
};

main().catch((error) => {
  process.stderr.write(String(error));
  process.exitCode = 1;
});

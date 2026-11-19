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
import { readFileSync } from 'node:fs';
import type { Metafile } from 'esbuild';
import type { RemoteWorkerSpec } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep, StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { KibanaRequest } from '@kbn/core/server';

interface Graph {
  spec: RemoteWorkerSpec;
  implementations: Record<string, () => Promise<Record<string, object>>>;
}

const main = async (): Promise<void> => {
  const directory = resolve(process.argv[2]);
  const graph: Graph = await import(pathToFileURL(join(directory, 'graph.mjs')).href);
  for (const root of [graph.spec.root, ...graph.spec.executorProviders, graph.spec.catalog])
    if (root) await graph.implementations[root.modulePath]();
  const sample = () => {
    assert(global.gc);
    global.gc();
    return process.memoryUsage();
  };
  let sequence = 1;
  let exists = false;
  let document = {
    user_id: 'owner',
    user_name: 'owner',
    agent_id: 'elastic-ai-agent',
    space: 'default',
    title: 'Conversation',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    conversation_rounds: [],
    events: [],
    schema_version: 1,
    access_control: { access_mode: 'private', entries: [] },
  };
  const before = sample();
  const provider = graph.spec.executorProviders.find(
    ({ tokenId }) => tokenId === 'workflows.dataPlane'
  );
  assert(provider);
  const loadedProvider = await graph.implementations[provider.modulePath]();
  const DataPlane = loadedProvider[provider.exportName] as new () => {
    open(scope: string, credentials: object): Promise<void>;
    close(scope: string): Promise<void>;
    internal(scope: string): ReturnType<StepHandlerContext['contextManager']['getScopedEsClient']>;
  };
  const dataPlane = new DataPlane();
  const sharedStarted = performance.now();
  const fake = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    response.setHeader('content-type', 'application/json');
    response.setHeader('x-elastic-product', 'Elasticsearch');
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path.includes('ai-index-idx-nightshift-cortex')) {
      const source = {
        '@timestamp': new Date().toISOString(),
        type: 'service',
        title: 'Fixture Cortex service',
        content: '# Populated Cortex page',
        tags: ['cortex', 'service'],
        attributes: {
          slug: 'fixture',
          status: 'established',
          corroborations: 2,
          space_id: 'default',
        },
      };
      response.end(
        JSON.stringify(
          path.endsWith('/_search')
            ? { hits: { hits: [{ _id: 'default:cortex_service_fixture', _source: source }] } }
            : { _id: 'default:cortex_service_fixture', found: true, _source: source }
        )
      );
      return;
    }
    if (path.includes('ai-index-idx-nightshift-decision-trees') && path.endsWith('/_search')) {
      const query = JSON.parse(body);
      const tree = query.query.bool.filter.some(
        (filter: { term?: { type?: string } }) => filter.term?.type === 'decision_tree'
      );
      response.end(
        JSON.stringify({
          hits: {
            hits: [
              {
                _source: tree
                  ? {
                      '@timestamp': new Date().toISOString(),
                      title: 'Fixture tree',
                      attributes: {
                        tree_id: 'symptom:fixture',
                        symptom: 'fixture',
                        version: 2,
                        status: 'established',
                      },
                      learnings: [],
                    }
                  : {
                      kind: 'remediation',
                      tree_id: 'symptom:fixture',
                      content: 'Fixture learning',
                      keywords: [],
                    },
              },
            ],
          },
        })
      );
      return;
    }
    if (path.includes('ai-index-idx-nightshift-decision-trees') && path.includes('/_doc/')) {
      response.end(
        JSON.stringify({
          found: true,
          _source: {
            '@timestamp': new Date().toISOString(),
            type: 'decision_tree',
            title: 'Fixture tree',
            content: '# Fixture populated tree',
            attributes: {
              tree_id: 'symptom:fixture',
              symptom: 'fixture',
              version: 2,
              status: 'established',
            },
            learnings: [],
          },
        })
      );
      return;
    }
    if (path.includes('/_inference/') && request.method === 'POST') {
      const input = JSON.parse(body);
      assert.deepEqual(input.input, ['First', 'Second']);
      response.end(
        JSON.stringify({
          rerank: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.1 },
          ],
        })
      );
      return;
    }
    if (path.includes('/_doc/') && request.method === 'GET') {
      const id = path.split('/_doc/')[1];
      if (id !== 'prime' && !exists) {
        response.statusCode = 404;
        response.end(
          JSON.stringify({
            error: { type: 'document_missing_exception', reason: 'Missing fixture document' },
            status: 404,
          })
        );
        return;
      }
      response.end(
        JSON.stringify({
          _id: id,
          _index: '.chat-conversations-000001',
          _seq_no: sequence,
          _primary_term: 1,
          found: true,
          _source: document,
        })
      );
      return;
    }
    if (path.includes('/_doc/') && request.method === 'PUT') {
      document = JSON.parse(body);
      exists = true;
      response.end(
        JSON.stringify({
          _id: 'conversation',
          _index: '.chat-conversations-000001',
          _seq_no: ++sequence,
          _primary_term: 1,
          result: 'created',
          _shards: { successful: 1 },
        })
      );
      return;
    }
    if (path === '/') {
      response.end('{"version":{"build_flavor":"default"}}');
      return;
    }
    if (request.method === 'GET') {
      response.end('{}');
      return;
    }
    if (request.method === 'PUT') {
      response.end('{"acknowledged":true}');
      return;
    }
    response.statusCode = 400;
    response.end(
      JSON.stringify({
        error: { type: 'unexpected_fixture_request', reason: `${request.method} ${path}` },
      })
    );
  });
  await new Promise<void>((done) => fake.listen(0, '127.0.0.1', done));
  const address = fake.address();
  assert(address && typeof address !== 'string');
  try {
    await dataPlane.open('scope', {
      node: `http://127.0.0.1:${address.port}`,
      internalHeaders: { authorization: 'fake' },
      userHeaders: { authorization: 'fake' },
    });
    await dataPlane.internal('scope').info();
    const sharedMs = performance.now() - sharedStarted;
    const sharedHeap = sample().heapUsed - before.heapUsed;
    const metadata: Metafile = JSON.parse(readFileSync(join(directory, 'metafile.json'), 'utf8'));
    const closure = (files: string[]): Set<string> => {
      const found = new Set<string>();
      const visit = (file: string) => {
        if (found.has(file)) return;
        found.add(file);
        for (const dependency of metadata.outputs[file].imports)
          if (!dependency.external && dependency.kind !== 'dynamic-import') visit(dependency.path);
      };
      files.forEach(visit);
      return found;
    };
    const roots = [graph.spec.root, ...graph.spec.executorProviders, graph.spec.catalog];
    const core = closure(
      Object.entries(metadata.outputs)
        .filter(([, output]) =>
          roots.some(
            (root) => root && output.entryPoint && resolve(output.entryPoint) === root.modulePath
          )
        )
        .map(([file]) => file)
    );
    const sdk = Object.entries(metadata.outputs).find(([, output]) =>
      Object.keys(output.inputs).some((path) =>
        path.endsWith('@elastic/elasticsearch/esm/index.js')
      )
    );
    assert(sdk);
    const sdkClosure = closure([sdk[0]]);
    const sharedBytes = [...sdkClosure]
      .filter((file) => !core.has(file))
      .reduce((total, file) => total + metadata.outputs[file].bytes, 0);
    const fakeClient = dataPlane.internal('scope');
    const registry = {
      getRenderingInput: async () => ({
        investigation: {
          investigation_id: 'investigation',
          title: 'Original title',
          summary: 'Original summary',
        },
        redirectUrl: '/app/r?original',
      }),
      ensure: async () => {},
      // Configuration capability fixture; actual ES operations still use the original native SDK.
      readTreePolicy: async () => ({ enabled: true }),
      resolve: async () => 'fixture-model',
      followUpRecoveredAlert: async () => ({
        investigation_id: 'investigation',
        execution_id: 'recovered-execution',
      }),
      read: async () => ({
        clientLeaseId: 'fixture-client',
        user: { id: 'owner', username: 'owner', isAdmin: true },
        space: 'default',
        emitsEvents: true,
        reportsCreation: true,
        reportsFieldChanges: true,
        logging: {
          client: { trace: false, debug: false, info: true, warn: true, error: true, fatal: true },
          storage: { trace: false, debug: false, info: true, warn: true, error: true, fatal: true },
        },
        templates: [
          {
            id: 'fixture',
            version: 1,
            name: 'Fixture',
            fields: {
              status: { input_type: 'SELECT', options: ['open', 'closed'], default_value: 'open' },
              summary: { input_type: 'TEXT' },
            },
          },
        ],
      }),
      assertAgentUse: async () => {},
      accessibleAgentIds: async () => ['elastic-ai-agent'],
      appendUserMessage: async (scope: string, id: string, message: string) => {
        assert.equal(scope, 'scope');
        assert.equal(id, 'conversation');
        assert.equal(message, 'Native message');
      },
      runAgent: async () => 'agent-result',
      takeResult: async () => ({
        outcome: {
          result: { message: 'Original agent response' },
          usage: { inputTokens: 12, outputTokens: 6, cachedTokens: 0, totalTokens: 18 },
        },
      }),
      cancel: async () => {},
      validateEvents: async (_scope: string, _clientLease: string, events: object[]) => events,
      prepareWrite: async (
        _scope: string,
        _clientLease: string,
        _id: string,
        expected?: { seqNo: number; primaryTerm: number }
      ) => ({
        writeLeaseId: 'fixture-write',
        version: expected ? { ...expected, revision: 1 } : undefined,
      }),
      notify: async () => {},
    };
    const logger = {
      get: () => logger,
      log() {},
      trace() {},
      debug() {},
      info() {},
      warn() {},
      error() {},
      fatal() {},
      isLevelEnabled: () => false,
    };
    const clientEntry = Object.entries(metadata.outputs).find(([, output]) =>
      output.entryPoint?.endsWith('/agent_builder/server/remote/native_conversation.ts')
    );
    assert(clientEntry);
    const clientBefore = sample();
    const clientStarted = performance.now();
    const module = await import(pathToFileURL(resolve(clientEntry[0])).href);
    const native = await module.createNativeConversation({
      registry,
      scopeId: 'scope',
      esClient: fakeClient,
      logger,
    });
    const first = await native.client.get('prime');
    assert.equal(first.title, 'Conversation');
    await native.drain();
    const clientMs = performance.now() - clientStarted;
    const clientHeap = sample().heapUsed - clientBefore.heapUsed;
    const clientBytes = [...closure([clientEntry[0]])]
      .filter((file) => !core.has(file) && !sdkClosure.has(file))
      .reduce((total, file) => total + metadata.outputs[file].bytes, 0);
    const attachments = {
      describe: async () => [{ id: 'text', isReadonly: false, canResolve: false }],
      validate: async (_scope: string, _type: string, data: object) => ({ valid: true, data }),
      resolve: async () => {
        throw new Error('The by-value budget fixture must not resolve an origin');
      },
    };
    const events = [];
    for (const [type, input] of [
      [
        'ai.conversation.create',
        { conversation_id: 'conversation', template_id: 'fixture', title: 'Native' },
      ],
      [
        'ai.conversation.metadata.patch',
        { conversation_id: 'conversation', updates: { status: 'closed', summary: 'Native' } },
      ],
      [
        'ai.conversation.add_event',
        { conversation_id: 'conversation', type: 'text_note', data: { text: 'Native' } },
      ],
      ['ai.conversation.metadata.read', { conversation_id: 'conversation' }],
      [
        'ai.conversation.add_user_message',
        { conversation_id: 'conversation', message: 'Native message' },
      ],
      [
        'ai.attachment.add',
        {
          conversation_id: 'conversation',
          id: 'text',
          type: 'text',
          data: { content: 'Original' },
        },
      ],
      [
        'ai.attachment.update',
        { conversation_id: 'conversation', attachment_id: 'text', data: { content: 'Updated' } },
      ],
      ['ai.attachment.read', { conversation_id: 'conversation', attachment_id: 'text' }],
      ['ai.attachment.list', { conversation_id: 'conversation' }],
      ['ai.attachment.delete', { conversation_id: 'conversation', attachment_id: 'text' }],
      ['ai.agent', { message: 'Original agent request' }],
      [
        'nightshift.composeHydrateNotifications',
        {
          writers: [
            { directory: '/workspace/memories', notification: 'Native memory', completed: true },
          ],
          recalled_ids: ['memory'],
        },
      ],
      [
        'nightshift.decisionTreePrepare',
        {
          response: 'status: confirmed',
          agent_id: 'nightshift.investigation',
          tool_calls: [
            {
              tool_id: 'nightshift_sandbox_view_file',
              params: { file_path: '/workspace/decision-trees/decision_tree_fixture.md' },
            },
          ],
        },
      ],
      [
        'nightshift.decisionTreeHydrate',
        { sandbox_id: 'default__fixture-conversation', agent_id: 'nightshift.investigation' },
      ],
      ['nightshift.cortexHydrate', { sandbox_id: 'default__fixture-conversation' }],
      ['nightshift.obtainSandbox', { conversation_id: 'fixture-conversation' }],
      ['nightshift.ensureInvestigationAgent', {}],
      ['nightshift.renderSlackMessage', { investigation_id: 'investigation', phase: 'completed' }],
      ['nightshift.resolveModel', { step: 'investigation', connector_id: 'fixture-model' }],
      [
        'nightshift.followUpRecoveredAlert',
        {
          alert_uuid: 'alert',
          alert_id: 'instance',
          rule_id: 'rule',
          rule_name: 'Rule',
          rule_type_id: 'type',
        },
      ],
      [
        'search.rerank',
        {
          rerank_text: 'Second',
          data: [{ title: 'First' }, { title: 'Second' }, { title: 'Tail' }],
          fields: [['title']],
          rank_window_size: 2,
        },
      ],
    ] as const) {
      const start = sample();
      const time = performance.now();
      const contribution = graph.spec.contributions.find(({ stepType }) => type === stepType);
      assert(contribution);
      const loaded = await graph.implementations[contribution.modulePath]();
      const Ctor = loaded[contribution.exportName] as new (
        operations: object,
        data: object,
        attachments: object
      ) => RemoteWorkflowStep;
      const context: StepHandlerContext = {
        input,
        rawInput: input,
        config: type === 'search.rerank' ? { inference_id: 'fixture-rerank' } : {},
        abortSignal: new AbortController().signal,
        stepId: type,
        stepType: type,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        contextManager: {
          getFakeRequest: () => ({} as KibanaRequest),
          getContext: () =>
            ({
              kibanaUrl: 'http://127.0.0.1:5635',
              execution: { id: 'run' },
              workflow: { id: 'workflow', name: 'Workflow', spaceId: 'default' },
            } as ReturnType<StepHandlerContext['contextManager']['getContext']>),
          getScopedEsClient: () => fakeClient,
          renderInputTemplate: <T>(value: T): T => value,
          callKibanaApi: async <T>() => ({
            body: { id: 'default' } as T,
            status: 200,
            headers: {},
          }),
        },
      };
      const sandboxWorkspaces = {
        allocate: async () => ({}),
        isCortexEnabled: async () => true,
        openCortexWorkspace: async () => 'cortex-ref',
        openDecisionTreeWorkspace: async () => 'tree-ref',
        mkdirs: async (_scope: string, _reference: string, paths: string[]) =>
          paths.map(() => true),
        writeFiles: async (
          _scope: string,
          _reference: string,
          files: Array<{ path: string; content: string }>
        ) =>
          files.map(({ content }) => ({
            bytes_written: Buffer.byteLength(content),
            success: true,
          })),
        reportCortexHydrated: async () => {},
      };
      const operations = [
        'nightshift.obtainSandbox',
        'nightshift.cortexHydrate',
        'nightshift.decisionTreeHydrate',
      ].includes(type)
        ? sandboxWorkspaces
        : type === 'nightshift.decisionTreePrepare'
        ? { read: registry.readTreePolicy }
        : registry;
      const result = (await new Ctor(
        operations,
        type === 'nightshift.decisionTreeHydrate'
          ? { read: registry.readTreePolicy }
          : { internal: () => fakeClient },
        attachments
      ).run('scope', {}, { handlerContext: context })) as {
        output?: object;
        error?: Error;
      };
      assert(!result.error, result.error?.message);
      assert(result.output);
      if (type === 'nightshift.composeHydrateNotifications')
        assert.deepEqual(result.output, {
          model_context: '<system_update>\nNative memory\n</system_update>',
          workflow_context: {
            'nightshift.semantic_memory.recall': { version: 1, data: { recalled_ids: ['memory'] } },
          },
        });
      if (type === 'nightshift.decisionTreePrepare') {
        const prepared = result.output as {
          message: string;
          tree_count: number;
          turn_kind: string;
        };
        assert.equal(prepared.tree_count, 1);
        assert.equal(prepared.turn_kind, 'feedback_reinforcement');
        assert(prepared.message.includes('Fixture learning'));
      }
      if (type === 'nightshift.decisionTreeHydrate')
        assert.equal((result.output as { tree_count: number }).tree_count, 1);
      if (type === 'nightshift.cortexHydrate')
        assert.deepEqual(result.output, {
          sandbox_id: 'default__fixture-conversation',
          conversation_id: 'fixture-conversation',
          notification: '',
        });
      if (type === 'nightshift.obtainSandbox')
        assert.deepEqual(result.output, {
          sandbox_id: 'default__fixture-conversation',
          conversation_id: 'fixture-conversation',
        });
      if (type === 'nightshift.ensureInvestigationAgent')
        assert.deepEqual(result.output, {
          space_id: 'default',
          agent_id: 'nightshift.investigation',
        });
      if (type === 'nightshift.renderSlackMessage')
        assert((result.output as { text: string }).text.includes('Original summary'));
      if (type === 'nightshift.resolveModel')
        assert.deepEqual(result.output, { connector_id: 'fixture-model' });
      if (type === 'nightshift.followUpRecoveredAlert')
        assert.deepEqual(result.output, {
          investigation_id: 'investigation',
          execution_id: 'recovered-execution',
        });
      if (type === 'search.rerank')
        assert.deepEqual(result.output, [
          { title: 'Second' },
          { title: 'First' },
          { title: 'Tail' },
        ]);
      const end = sample();
      events.push({
        type,
        heapIncrement: end.heapUsed - start.heapUsed,
        ms: performance.now() - time,
      });
    }
    const final = await native.client.get('conversation');
    assert.equal(final.attachments?.[0].current_version, 2);
    assert.equal(final.attachments?.[0].active, false);
    assert.deepEqual(final.attachments?.[0].versions[1].data, { content: 'Updated' });
    process.stdout.write(
      JSON.stringify({
        sharedHeap,
        sharedMs,
        sharedBytes,
        clientHeap,
        clientMs,
        clientBytes,
        events,
      })
    );
  } finally {
    await dataPlane.close('scope');
    fake.closeAllConnections();
    await new Promise<void>((done) => fake.close(() => done()));
  }
};

main().catch((error) => {
  process.stderr.write(String(error));
  process.exitCode = 1;
});

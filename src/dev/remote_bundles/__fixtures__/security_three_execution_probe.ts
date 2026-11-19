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
  const before = sample();
  const provider = graph.spec.executorProviders.find(
    ({ tokenId }) => tokenId === 'workflows.dataPlane'
  );
  assert(provider);
  const loadedProvider = await graph.implementations[provider.modulePath]();
  const DataPlane = loadedProvider[provider.exportName] as new () => {
    open(scope: string, credentials: object): Promise<void>;
    close(scope: string): Promise<void>;
  };
  const dataPlane = new DataPlane();
  const sharedStarted = performance.now();
  await dataPlane.open('scope', {
    node: 'http://127.0.0.1:1',
    internalHeaders: { authorization: 'fake' },
    userHeaders: { authorization: 'fake' },
  });
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
    Object.keys(output.inputs).some((path) => path.endsWith('@elastic/elasticsearch/esm/index.js'))
  );
  assert(sdk);
  const sdkClosure = closure([sdk[0]]);
  const sharedBytes = [...sdkClosure]
    .filter((file) => !core.has(file))
    .reduce((total, file) => total + metadata.outputs[file].bytes, 0);
  const response = {
    aggregations: {
      host_count: { value: 1 },
      host_entities: {
        buckets: [
          { key: 'host:host', latest: { hits: { hits: [{ fields: { 'host.name': ['host'] } }] } } },
        ],
      },
    },
  };
  const entitiesEntry = Object.entries(metadata.outputs).find(([, output]) =>
    Object.keys(output.inputs).some((path) =>
      path.endsWith('/get_alert_entities_step/get_alert_entities.ts')
    )
  );
  assert(entitiesEntry);
  const entityBefore = sample();
  const entityStarted = performance.now();
  const entitiesModule = await import(pathToFileURL(resolve(entitiesEntry[0])).href);
  const resolved = await entitiesModule.getAlertEntities({
    alertIds: ['alert'],
    entityTypes: ['host'],
    maxEntities: 50,
    spaceId: 'default',
    esClient: { search: async () => response },
  });
  assert.deepEqual(resolved, {
    entities: [{ id: 'host:host', name: 'host', type: 'host' }],
    total: 1,
    truncated: false,
  });
  const entitiesMs = performance.now() - entityStarted;
  const entitiesHeap = sample().heapUsed - entityBefore.heapUsed;
  const entitiesBytes = [...closure([entitiesEntry[0]])]
    .filter((file) => !core.has(file) && !sdkClosure.has(file))
    .reduce((total, file) => total + metadata.outputs[file].bytes, 0);
  const events = [];
  for (const [type, input] of [
    ['security.getAlertEntities', { alert_ids: ['alert'], entity_types: ['host'] }],
    [
      'security.buildExceptionEntriesFilter',
      { entries: [{ field: 'host.name', operator: 'is', value: 'host' }] },
    ],
    ['security.matchAttackFingerprints', { attacks: [] }],
  ] as const) {
    const start = sample();
    const time = performance.now();
    const contribution = graph.spec.contributions.find(({ stepType }) => type === stepType);
    assert(contribution);
    const loaded = await graph.implementations[contribution.modulePath]();
    const Ctor = loaded[contribution.exportName] as new (operations: object) => RemoteWorkflowStep;
    const context: StepHandlerContext = {
      input,
      rawInput: input,
      config: {},
      abortSignal: new AbortController().signal,
      stepId: type,
      stepType: type,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      contextManager: {
        getFakeRequest: () => ({} as KibanaRequest),
        getContext: () =>
          ({
            execution: { id: 'run' },
            workflow: { id: 'workflow', name: 'Workflow', spaceId: 'default' },
          } as ReturnType<StepHandlerContext['contextManager']['getContext']>),
        getScopedEsClient: () =>
          ({ search: async () => response } as ReturnType<
            StepHandlerContext['contextManager']['getScopedEsClient']
          >),
        renderInputTemplate: <T>(value: T): T => value,
        callKibanaApi: async <T>() => ({
          body: { id: 'default' } as T,
          status: 200,
          headers: {},
        }),
      },
    };
    const result = (await new Ctor({ canCreate: async () => false }).run(
      'scope',
      {},
      { handlerContext: context }
    )) as {
      output?: object;
      error?: Error;
    };
    assert(!result.error, result.error?.message);
    assert(result.output);
    const end = sample();
    events.push({
      type,
      heapIncrement: end.heapUsed - start.heapUsed,
      ms: performance.now() - time,
    });
  }
  await dataPlane.close('scope');
  process.stdout.write(
    JSON.stringify({
      sharedHeap,
      sharedMs,
      sharedBytes,
      entitiesHeap,
      entitiesMs,
      entitiesBytes,
      events,
    })
  );
};

main().catch((error) => {
  process.stderr.write(String(error));
  process.exitCode = 1;
});

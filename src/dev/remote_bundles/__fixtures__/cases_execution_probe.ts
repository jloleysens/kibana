/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Metafile } from 'esbuild';
import type { RemoteWorkerSpec } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep, StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { KibanaRequest } from '@kbn/core/server';
import { createCaseResponseFixture } from '@kbn/cases-plugin/common/fixtures/create_case';

interface Graph {
  spec: RemoteWorkerSpec;
  implementations: Record<string, () => Promise<Record<string, object>>>;
}

const main = async (): Promise<void> => {
  const directory = resolve(process.argv[2]);
  const graph: Graph = await import(pathToFileURL(join(directory, 'graph.mjs')).href);
  const metadata: Metafile = JSON.parse(readFileSync(join(directory, 'metafile.json'), 'utf8'));
  for (const root of [graph.spec.root, ...graph.spec.executorProviders, graph.spec.catalog])
    if (root) await graph.implementations[root.modulePath]();
  const sample = () => {
    assert(global.gc);
    global.gc();
    return process.memoryUsage();
  };
  const before = sample();
  const sharedFiles = Object.entries(metadata.outputs)
    .filter(([, output]) =>
      Object.keys(output.inputs).some(
        (path) =>
          path.endsWith('/cases/common/workflows/steps/shared.ts') ||
          path.endsWith('/cases/server/workflows/steps/utils.ts')
      )
    )
    .map(([file]) => file);
  assert(sharedFiles.length > 0);
  const fakeCase = {
    ...createCaseResponseFixture,
    comments: [],
    assignees: [],
    category: null,
    customFields: [],
    owner: 'cases',
  };
  const started = performance.now();
  let schema: { safeParse(value: object): { success: boolean } } | undefined;
  let validate: ((outputSchema: object, value: object) => object) | undefined;
  for (const file of sharedFiles) {
    const module = await import(pathToFileURL(resolve(file)).href);
    if (module.CasesStepSingleCaseOutputSchema) schema = module.CasesStepSingleCaseOutputSchema;
    if (module.safeParseCaseForWorkflowOutput) validate = module.safeParseCaseForWorkflowOutput;
  }
  assert(schema && validate);
  assert(schema.safeParse({ case: fakeCase }).success, 'Shared Cases first response must be valid');
  validate(schema, { case: fakeCase });
  const sharedMs = performance.now() - started;
  const shared = sample();
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
      .filter(([, output]) =>
        [graph.spec.root, ...graph.spec.executorProviders, graph.spec.catalog].some(
          (provider) =>
            provider && output.entryPoint && resolve(output.entryPoint) === provider.modulePath
        )
      )
      .map(([file]) => file)
  );
  const sharedBytes = [...closure(sharedFiles)]
    .filter((file) => !core.has(file))
    .reduce((bytes, file) => bytes + metadata.outputs[file].bytes, 0);
  const calls: string[] = [];
  const api = {
    caseCreate: async () => {
      calls.push('create');
      return fakeCase;
    },
    caseGet: async () => {
      calls.push('get');
      return fakeCase;
    },
    caseBulkUpdate: async () => {
      calls.push('bulkUpdate');
      return [fakeCase];
    },
    attachmentAdd: async () => {
      calls.push('attachmentAdd');
      return fakeCase;
    },
    caseFind: async () => {
      calls.push('find');
      return {
        page: 1,
        per_page: 20,
        total: 1,
        cases: [fakeCase],
        count_open_cases: 1,
        count_in_progress_cases: 0,
        count_closed_cases: 0,
      };
    },
  };
  const events = [];
  for (const [type, input] of [
    [
      'cases.createCase',
      {
        title: 'Original Cases handler',
        description: 'Local client capability fixture',
        owner: 'cases',
      },
    ],
    ['cases.updateCase', { case_id: fakeCase.id, updates: { title: 'Updated' } }],
    ['cases.addComment', { case_id: fakeCase.id, comment: 'Local original attachment' }],
    ['cases.findCases', { owner: ['cases'] }],
    ['cases.getCase', { case_id: fakeCase.id }],
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
        getScopedEsClient: () => {
          throw new Error('Cases must use the authenticated Cases service');
        },
        renderInputTemplate: <T>(value: T): T => value,
        callKibanaApi: async () => {
          throw new Error('Cases must use its typed client capability');
        },
      },
    };
    const count = calls.length;
    const result = (await new Ctor(api).run('scope', {}, { handlerContext: context })) as {
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
      operations: calls.slice(count),
    });
  }
  process.stdout.write(
    JSON.stringify({ sharedHeap: shared.heapUsed - before.heapUsed, sharedBytes, sharedMs, events })
  );
};

main().catch((error) => {
  process.stderr.write(String(error));
  process.exitCode = 1;
});

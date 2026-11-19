/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { MessageChannel } from 'node:worker_threads';
import { expose, openPortSession } from '@kbn/core-remote-common';
import type { AiIndexDest } from '../../common/http_api/ai_indices';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { elasticsearchServiceMock, httpServerMock } from '@kbn/core/server/mocks';
import { ExecutionError } from '@kbn/workflows/server';
import { KiOperations } from './ki_operations';
import type { KiOperationsApi } from './ki_tokens';
import { CreateKiStep } from './create_ki_step';
import { UpdateKiStep } from './update_ki_step';
import { DeleteKiStep } from './delete_ki_step';
import { VerifyKiStep } from './verify_ki_step';
import { restoreKiError } from './ki_errors';
import { KiConflictError } from '../ai_indices/errors';
import {
  createMockStepContext,
  mockAiIndexService,
  mockKiStepTelemetry,
} from '../step_types/test_utils';
import type { KiOperationsDependencies } from './ki_operations';

const setup = (dest: AiIndexDest = { type: 'index', value: 'trusted-dest' }) => {
  const controller = new AbortController();
  const request = httpServerMock.createKibanaRequest();
  const esClient = elasticsearchServiceMock.createElasticsearchClient();
  const service = mockAiIndexService(dest, true);
  const telemetry = mockKiStepTelemetry();
  const verify = jest
    .fn<
      ReturnType<KiOperationsDependencies['verify']>,
      Parameters<KiOperationsDependencies['verify']>
    >()
    .mockResolvedValue({ passed: true, results: [] });
  const scopes: ScopeLookup = {
    get: jest.fn().mockReturnValue(request),
    getRunState: (scopeId) => {
      if (scopeId !== 'scope') throw new Error('Unknown scope');
      return {
        workflowId: 'trusted-workflow',
        workflowName: 'Trusted',
        workflowRunId: 'trusted-run',
        spaceId: 'trusted-space',
        admittedChildren: new Set(),
      };
    },
    getRunDefinitionFacts: () => ({
      workflowVersion: 7,
      metadata: { ki_verifier_chain: ['trusted-ancestor'] },
      parent: { workflowId: 'trusted-parent', executionId: 'trusted-parent-run' },
    }),
    getAbortSignal: (scopeId) => {
      if (scopeId !== 'scope') throw new Error('Unknown scope');
      return controller.signal;
    },
    resolveStepType: (_scope, stepId) => {
      const types: Record<string, string> = {
        create: 'context-engine.createKi',
        update: 'context-engine.updateKi',
        delete: 'context-engine.deleteKi',
      };
      if (!types[stepId]) throw new Error('Unknown step');
      return types[stepId];
    },
    resolveStepOutputLimit: jest.fn(),
    admitChild: jest.fn(),
  };
  const dependencies: KiOperationsDependencies = {
    ...telemetry,
    getAiIndexService: () => service,
    isContextEngineEnabled: jest.fn(async () => true),
    checkWritePrivilege: jest.fn(async () => true),
    getScopedEsClient: jest.fn(async () => esClient),
    verify,
  };
  const api = new KiOperations(scopes, dependencies);
  const open = async (stepId = 'update') => {
    const ref = await api.openWrite('scope', stepId, 'ai-index');
    await api.authorizeWrite('scope', ref);
    await api.resolve('scope', ref);
    return ref;
  };
  return {
    controller,
    request,
    esClient,
    service,
    telemetry,
    verify,
    scopes,
    dependencies,
    api,
    open,
  };
};
const writer = {
  uri: 'workflow://trusted-workflow',
  metadata: { version: 7, run_id: 'trusted-run', space_id: 'trusted-space' },
};

it('stamps final creates from coordinator facts, never supplied provenance or space', async () => {
  const { api, open, esClient, telemetry } = setup();
  const ref = await open('create');
  await api.putRevision(
    'scope',
    ref,
    'ki',
    {
      type: 'document',
      title: 'Original',
      governance: {
        provenance: {
          created_by: { uri: 'forged', metadata: { space_id: 'foreign' } },
          updated_by: { uri: 'forged', metadata: {} },
        },
      },
    },
    true
  );
  expect(esClient.index).toHaveBeenCalledWith(
    expect.objectContaining({
      index: 'trusted-dest',
      id: 'ki',
      document: {
        type: 'document',
        title: 'Original',
        id: 'ki',
        governance: { provenance: { created_by: writer, updated_by: writer } },
      },
    }),
    expect.anything()
  );
  await api.finishWrite('scope', ref, { id: 'ki' });
  expect(telemetry.analyticsService.reportKiWrite).toHaveBeenCalledWith({
    action: 'create',
    aiIndexId: 'ai-index',
    managed: true,
    outcome: 'success',
  });
  await expect(api.finishWrite('scope', ref, { id: 'ki' })).rejects.toThrow(
    'Unknown KI write reference'
  );
});

it('uses only coordinator-retained revisions/destinations and stamps updates; references are single use', async () => {
  const { api, open, esClient } = setup();
  const ref = await open();
  esClient.search.mockResponse({
    took: 1,
    timed_out: false,
    _shards: { total: 1, successful: 1, failed: 0 },
    hits: {
      hits: [
        {
          _index: 'trusted-backing',
          _id: 'ki',
          _seq_no: 2,
          _primary_term: 3,
          _source: { title: 'Before' },
        },
      ],
    },
  });
  const read = await api.readRevision('scope', ref, 'ki', true);
  read.revision.index = 'forged';
  read.revision.source.title = 'forged';
  await api.writeRevision(
    'scope',
    ref,
    read.reference,
    { title: 'After', updated_at: 'now', governance: {} },
    false
  );
  expect(esClient.update).toHaveBeenCalledWith(
    {
      index: 'trusted-backing',
      id: 'ki',
      if_seq_no: 2,
      if_primary_term: 3,
      doc: {
        title: 'After',
        updated_at: 'now',
        governance: { provenance: { updated_by: writer } },
      },
    },
    expect.anything()
  );
  await expect(
    api.writeRevision('scope', ref, read.reference, { updated_at: 'now', governance: {} }, false)
  ).rejects.toThrow('Unknown KI revision');
  await api.finishWrite('scope', ref, { id: 'ki' });
});

it('refuses foreign/unknown/closed scopes, foreign references and wrong persisted step types', async () => {
  const { api, open, controller, scopes } = setup();
  await expect(api.openWrite('foreign', 'update', 'index')).rejects.toThrow('Unknown scope');
  await expect(api.openWrite('scope', 'missing', 'index')).rejects.toThrow('Unknown step');
  jest.spyOn(scopes, 'resolveStepType').mockReturnValueOnce('console');
  await expect(api.openWrite('scope', 'update', 'index')).rejects.toThrow('Not a KI write step');
  const ref = await open();
  await expect(api.authorizeWrite('scope', 'foreign-ref')).rejects.toThrow(
    'Unknown KI write reference'
  );
  controller.abort();
  await expect(api.resolve('scope', ref)).rejects.toThrow();
});

it('retains original permission errors, managed telemetry and scope-close cancellation cleanup', async () => {
  const { api, dependencies, esClient, telemetry, controller } = setup();
  jest.mocked(dependencies.checkWritePrivilege).mockResolvedValue(false);
  const ref = await api.openWrite('scope', 'delete', 'index');
  await expect(restoreKiError(api.authorizeWrite('scope', ref))).rejects.toMatchObject({
    type: 'PermissionError',
  });
  await api.finishWrite('scope', ref, {
    error: { type: 'PermissionError', message: 'Denied', aborted: false },
  });
  expect(telemetry.analyticsService.reportKiWrite).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'delete',
      outcome: 'failure',
      errorType: 'PermissionError',
      managed: undefined,
    })
  );
  expect(esClient.index).not.toHaveBeenCalled();
  await api.openWrite('scope', 'update', 'index');
  controller.abort();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(telemetry.analyticsService.reportKiWrite).toHaveBeenLastCalledWith(
    expect.objectContaining({ outcome: 'aborted' })
  );
});

it('verifies with original scoped request and coordinator-only version/ancestry, ignoring forged extra fields', async () => {
  const { api, verify, request } = setup();
  const params = {
    ki: { type: 'document', title: 'KI' },
    verifiers: [{ workflow_id: 'verifier' }],
    workflow: { id: 'forged' },
    parent: { workflowId: 'forged' },
    request: { headers: { authorization: 'forged' } },
  };
  await api.verify('scope', await api.openVerification('scope'), params);
  expect(verify).toHaveBeenCalledWith(
    expect.objectContaining({
      request,
      workflow: {
        id: 'trusted-workflow',
        name: 'Trusted',
        enabled: true,
        spaceId: 'trusted-space',
        version: 7,
      },
      parent: { workflowId: 'trusted-parent', executionId: 'trusted-parent-run' },
      metadata: { ki_verifier_chain: ['trusted-ancestor'] },
    })
  );
});

it('serializes safe original ExecutionError/KI prototypes without exporting private metadata', async () => {
  const { api, dependencies, controller } = setup();
  const { port1, port2 } = new MessageChannel();
  try {
    const remote = openPortSession<KiOperationsApi>(port1);
    openPortSession(port2, expose(api));
    for (const original of [
      new ExecutionError({ type: 'PermissionError', message: 'Denied' }),
      new KiConflictError('index', 'ki'),
      new TypeError('Original type'),
    ]) {
      Object.assign(original, {
        privateAuthorization: 'private-secret',
        meta: { headers: { authorization: 'private-secret' } },
      });
      jest.mocked(dependencies.checkWritePrivilege).mockRejectedValueOnce(original);
      const ref = await remote.openWrite('scope', 'update', 'index');
      try {
        await restoreKiError(remote.authorizeWrite('scope', ref));
        throw new Error('Expected failure');
      } catch (error) {
        expect(error).toBeInstanceOf(original.constructor);
        expect(error).toMatchObject({ message: original.message });
        expect(JSON.stringify(error)).not.toContain('private-secret');
      }
      expect(original).toHaveProperty('privateAuthorization', 'private-secret');
      await remote.finishWrite('scope', ref, {
        error: { type: 'test', message: 'test', aborted: false },
      });
    }
    expect(api).not.toHaveProperty('invoke');
  } finally {
    controller.abort();
    port1.close();
    port2.close();
  }
});

it('runs original create/update/noop/delete decision code in worker-local handlers with no generic invocation', async () => {
  const { api, esClient, telemetry } = setup();
  const context = (stepId: string, input: object) => {
    const handlerContext = createMockStepContext({ input, esClient });
    handlerContext.stepId = stepId;
    return { handlerContext };
  };
  await expect(
    new CreateKiStep(api).run(
      'scope',
      {},
      context('create', {
        ai_index_id: 'ai-index',
        ki_id: 'ki',
        ki: { type: 'document', title: 'Before', attributes: { omit: null, keep: 'value' } },
      })
    )
  ).resolves.toEqual({ output: { id: 'ki' } });
  esClient.search.mockResponse({
    took: 1,
    timed_out: false,
    _shards: { total: 1, successful: 1, failed: 0 },
    hits: {
      hits: [{ _index: 'trusted-dest', _id: 'ki', _source: { type: 'document', title: 'Before' } }],
    },
  });
  esClient.update.mockResponse({
    result: 'updated',
    _id: 'ki',
    _index: 'trusted-dest',
    _version: 2,
    _shards: { total: 1, successful: 1, failed: 0 },
  });
  await expect(
    new UpdateKiStep(api).run(
      'scope',
      {},
      context('update', { ai_index_id: 'ai-index', ki_id: 'ki', ki: { title: 'After' } })
    )
  ).resolves.toEqual({ output: { id: 'ki', result: 'updated' } });
  await expect(
    new UpdateKiStep(api).run(
      'scope',
      {},
      context('update', { ai_index_id: 'ai-index', ki_id: 'ki', ki: { title: 'Before' } })
    )
  ).resolves.toEqual({ output: { id: 'ki', result: 'noop' } });
  await expect(
    new DeleteKiStep(api).run(
      'scope',
      {},
      context('delete', { ai_index_id: 'ai-index', ki_id: 'ki' })
    )
  ).resolves.toEqual({ output: { id: 'ki' } });
  expect(esClient.update).toHaveBeenCalledTimes(2);
  expect(telemetry.analyticsService.reportKiWrite).toHaveBeenCalledTimes(4);
});

it.each([CreateKiStep, UpdateKiStep, DeleteKiStep])(
  'refuses missing local handler context for %p',
  async (Step) => {
    const { api } = setup();
    await expect(new Step(api).run('scope', {}, {})).rejects.toThrow(
      'executor-local handler context'
    );
  }
);

it('keeps original verify normalization/output in the worker and live registry execution coordinator-side', async () => {
  const { api, verify } = setup();
  const settings = {
    isContextEngineEnabled: async () => true,
    isFeedbackLoopEnabled: async () => true,
    buildContext: jest.fn(),
  };
  const handlerContext = createMockStepContext({
    input: { ki: { type: 'document', title: 'KI', attributes: { omit: null, keep: 'value' } } },
    esClient: {},
  });
  await expect(
    new VerifyKiStep(api, settings).run('scope', {}, { handlerContext })
  ).resolves.toEqual({ output: { passed: true, results: [] } });
  expect(verify).toHaveBeenCalledWith(
    expect.objectContaining({
      ki: { type: 'document', title: 'KI', attributes: { keep: 'value' } },
    })
  );
});

it('cancels only the current write, propagates cancellation to the original ES options and leaves its run alive', async () => {
  const { api, open, controller, esClient, telemetry } = setup();
  const reference = await open('create');
  await api.putRevision('scope', reference, 'ki', { type: 'document', title: 'KI' }, false);
  const signal = esClient.index.mock.calls[0][1]?.signal;
  expect(signal?.aborted).toBe(false);
  await api.cancelWrite('scope', reference);
  expect(signal?.aborted).toBe(true);
  expect(controller.signal.aborted).toBe(false);
  await api.assertEnabled('scope');
  await expect(api.resolve('scope', reference)).rejects.toThrow('Unknown KI write reference');
  expect(telemetry.analyticsService.reportKiWrite).toHaveBeenCalledWith(
    expect.objectContaining({ outcome: 'aborted' })
  );
});

it('propagates the original step abort to the scoped verifier, not the whole run', async () => {
  const { api, verify, controller } = setup();
  let started: () => void = () => {
    throw new Error('Verifier start not initialized');
  };
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  verify.mockImplementation(async ({ abortSignal }) => {
    started();
    return new Promise((resolve, reject) => {
      abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true });
    });
  });
  const stepAbort = new AbortController();
  const context = createMockStepContext({
    input: { ki: { type: 'document', title: 'KI' } },
    esClient: {},
    abortController: stepAbort,
  });
  const settings = {
    isContextEngineEnabled: async () => true,
    isFeedbackLoopEnabled: async () => true,
    buildContext: jest.fn(),
  };
  const result = new VerifyKiStep(api, settings).run('scope', {}, { handlerContext: context });
  await ready;
  stepAbort.abort();
  await expect(result).rejects.toThrow();
  expect(verify.mock.calls[0][0].abortSignal.aborted).toBe(true);
  expect(controller.signal.aborted).toBe(false);
});

it('appends data-stream revisions from the coordinator source snapshot, preserving original creator attribution', async () => {
  const { api, open, esClient } = setup({ type: 'data_stream', value: 'trusted-stream' });
  const reference = await open();
  const createdBy = { uri: 'workflow://original-creator', metadata: { run_id: 'original-run' } };
  esClient.search.mockResponse({
    took: 1,
    timed_out: false,
    _shards: { total: 1, successful: 1, failed: 0 },
    hits: {
      hits: [
        {
          _index: '.ds-trusted-stream',
          _id: 'physical',
          _source: {
            id: 'ki',
            title: 'Before',
            governance: { provenance: { created_by: createdBy } },
          },
        },
      ],
    },
  });
  const read = await api.readRevision('scope', reference, 'ki', true);
  read.revision.source.governance = { provenance: { created_by: { uri: 'forged', metadata: {} } } };
  await api.writeRevision(
    'scope',
    reference,
    read.reference,
    { title: 'After', updated_at: 'now', governance: {} },
    true
  );
  expect(esClient.index).toHaveBeenCalledWith(
    {
      index: 'trusted-stream',
      op_type: 'create',
      refresh: 'wait_for',
      document: {
        id: 'ki',
        title: 'After',
        '@timestamp': 'now',
        updated_at: 'now',
        governance: { provenance: { created_by: createdBy, updated_by: writer } },
      },
    },
    expect.anything()
  );
  await api.finishWrite('scope', reference, { id: 'ki' });
});

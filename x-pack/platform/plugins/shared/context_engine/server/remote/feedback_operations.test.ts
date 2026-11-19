/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { MessageChannel } from 'node:worker_threads';
import { expose, openPortSession } from '@kbn/core-remote-common';
import {
  elasticsearchServiceMock,
  httpServerMock,
  loggingSystemMock,
} from '@kbn/core/server/mocks';
import { AiIndexService } from '../ai_indices/service';
import { ImprovementsService } from '../improvements/service';
import { buildFeedbackContext } from '../feedback_analysis/context';
import { InvalidSignalWindowError } from '../feedback_analysis/errors';

jest.mock('../feedback_analysis/context');
const buildContext = jest.mocked(buildFeedbackContext);
const context = {
  agent_id: 'analysis-agent',
  briefing: 'Original briefing',
  output_schema: {},
  has_signals: true,
  run: {
    signal_window: { from: '2026-01-01', to: '2026-02-01' },
    signal_spaces: ['own-space'],
    signal_count: 1,
  },
};
beforeEach(() => {
  jest.clearAllMocks();
  buildContext.mockReset();
  buildContext.mockResolvedValue(context);
});
import { AiIndexNotFoundError } from '../ai_indices/errors';
import { FeedbackOperations } from './feedback_operations';
import type { FeedbackOperationsApi, FeedbackContextResult } from './feedback_tokens';
import { FeedbackContextStep } from './feedback_context_step';
import { restoreRegistryError } from './registry_errors';
import { createMockStepContext } from '../step_types/test_utils';

const setup = () => {
  const controller = new AbortController();
  const request = httpServerMock.createKibanaRequest();
  const esClient = elasticsearchServiceMock.createElasticsearchClient();
  const logger = loggingSystemMock.createLogger();
  const aiIndexService = new AiIndexService({ esClient, logger });
  const getAiIndexService = jest.fn(() => aiIndexService);
  const improvementsService = new ImprovementsService({ esClient, logger, space: 'own-space' });
  const getImprovementsService = jest.fn(() => improvementsService);
  const getScopedEsClient = jest.fn(async () => esClient);
  const isContextEngineEnabled = jest.fn(async () => true);
  const isFeedbackLoopEnabled = jest.fn(async () => true);
  const api = new FeedbackOperations(
    {
      get: jest.fn().mockReturnValue(request),
      getRunState: (scopeId) => {
        if (scopeId !== 'run') throw new Error('Foreign scope');
        return {
          workflowRunId: 'trusted-run',
          workflowId: 'trusted-workflow',
          workflowName: 'Trusted workflow',
          spaceId: 'own-space',
          admittedChildren: new Set<string>(),
        };
      },
      getAbortSignal: (scopeId) => {
        if (scopeId !== 'run') throw new Error('Foreign scope');
        return controller.signal;
      },
      resolveStepType: jest.fn(),
      resolveStepOutputLimit: jest.fn(),
      admitChild: jest.fn(),
    },
    {
      getAiIndexService,
      getImprovementsService,
      getScopedEsClient,
      isContextEngineEnabled,
      isFeedbackLoopEnabled,
    }
  );
  return {
    api,
    controller,
    getAiIndexService,
    getImprovementsService,
    getScopedEsClient,
    request,
    esClient,
    aiIndexService,
    improvementsService,
    isContextEngineEnabled,
    isFeedbackLoopEnabled,
  };
};

it('derives every registry and setting lookup space from the coordinator, not extra worker arguments', async () => {
  const {
    api,
    request,
    esClient,
    aiIndexService,
    improvementsService,
    getScopedEsClient,
    getImprovementsService,
    isContextEngineEnabled,
    isFeedbackLoopEnabled,
  } = setup();
  const { port1, port2 } = new MessageChannel();
  try {
    const remote = openPortSession<FeedbackOperationsApi>(port1);
    openPortSession(port2, expose(api));
    await Reflect.apply(remote.buildContext, remote, ['run', 'index', 'foreign-space']);
    await remote.isContextEngineEnabled('run');
    await remote.isFeedbackLoopEnabled('run');
    expect(getScopedEsClient).toHaveBeenCalledWith(request);
    expect(getImprovementsService).toHaveBeenCalledWith(esClient, 'own-space');
    expect(buildContext).toHaveBeenCalledWith('index', 'own-space', {
      esClient,
      aiIndexService,
      improvementsService,
    });
    expect(isContextEngineEnabled).toHaveBeenCalledWith('own-space');
    expect(isFeedbackLoopEnabled).toHaveBeenCalledWith();
    expect('invoke' in expose(api)).toBe(false);
    expect('read' in expose(api)).toBe(false);
  } finally {
    port1.close();
    port2.close();
  }
});

it('refuses foreign and closed scopes before reading the original live registry or settings', async () => {
  const { api, controller, getAiIndexService, isContextEngineEnabled, isFeedbackLoopEnabled } =
    setup();
  await expect(api.buildContext('foreign', 'index')).rejects.toThrow('Foreign scope');
  await expect(api.isContextEngineEnabled('foreign')).rejects.toThrow('Foreign scope');
  controller.abort();
  await expect(api.buildContext('run', 'index')).rejects.toThrow();
  await expect(api.isFeedbackLoopEnabled('run')).rejects.toThrow();
  expect(getAiIndexService).not.toHaveBeenCalled();
  expect(isContextEngineEnabled).not.toHaveBeenCalled();
  expect(isFeedbackLoopEnabled).not.toHaveBeenCalled();
});

it('rechecks closure after an asynchronous registry read', async () => {
  const { api, controller } = setup();
  buildContext.mockImplementationOnce(async () => {
    controller.abort();
    return context;
  });
  await expect(api.buildContext('run', 'index')).rejects.toThrow();
});

it('represents original not-found explicitly without swallowing other failures or leaking ES headers over RPC', async () => {
  const { api } = setup();
  const denied = Object.assign(new TypeError('Original denial'), {
    headers: { authorization: 'fake-private-authorization' },
  });
  buildContext
    .mockRejectedValueOnce(new AiIndexNotFoundError('index'))
    .mockRejectedValueOnce(denied);
  const { port1, port2 } = new MessageChannel();
  try {
    const remote = openPortSession<FeedbackOperationsApi>(port1);
    openPortSession(port2, expose(api));
    await expect(remote.buildContext('run', 'index')).resolves.toEqual({ outcome: 'not-found' });
    try {
      await remote.buildContext('run', 'index');
      throw new Error('Expected original denial');
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect(error).toHaveProperty('message', 'Original denial');
      expect(JSON.stringify(error)).not.toContain('fake-private-authorization');
      expect(error).not.toHaveProperty('headers');
    }
    expect(denied.headers.authorization).toBe('fake-private-authorization');
  } finally {
    port1.close();
    port2.close();
  }
});

it('requires executor-local context, with no generic handler fallback', async () => {
  const { api, getAiIndexService } = setup();
  await expect(new FeedbackContextStep(api).run('run', {}, {})).rejects.toThrow(
    'executor-local handler context'
  );
  expect(getAiIndexService).not.toHaveBeenCalled();
});

it('keeps the original disabled-setting precedence without consulting the feedback flag or AI registry', async () => {
  const { api, isContextEngineEnabled, isFeedbackLoopEnabled, getAiIndexService } = setup();
  isContextEngineEnabled.mockResolvedValue(false);
  isFeedbackLoopEnabled.mockRejectedValue(new Error('Must not be consulted'));
  await expect(
    new FeedbackContextStep(api).run(
      'run',
      {},
      {
        handlerContext: createMockStepContext({ input: { ai_index_id: 'index' }, esClient: {} }),
      }
    )
  ).rejects.toMatchObject({ type: 'FeatureDisabledError' });
  expect(isFeedbackLoopEnabled).not.toHaveBeenCalled();
  expect(getAiIndexService).not.toHaveBeenCalled();
});

it.each([Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError])(
  'preserves original %p retry class and custom public name over RPC',
  async (ErrorType) => {
    const { api } = setup();
    const original = Object.assign(new ErrorType('Original failure'), {
      name: 'OriginalPublicName',
      privateAuthorization: 'fake-private',
    });
    buildContext.mockRejectedValueOnce(original);
    const { port1, port2 } = new MessageChannel();
    try {
      const remote = openPortSession<FeedbackOperationsApi>(port1);
      openPortSession(port2, expose(api));
      try {
        await restoreRegistryError<FeedbackContextResult>(remote.buildContext('run', 'index'));
        throw new Error('Expected failure');
      } catch (error) {
        expect(error).toBeInstanceOf(ErrorType);
        expect(error).toMatchObject({ name: 'OriginalPublicName', message: 'Original failure' });
        expect(JSON.stringify(error)).not.toContain('fake-private');
      }
    } finally {
      port1.close();
      port2.close();
    }
  }
);

it('restores original service-specific not-found/window failures through the original worker error projection', async () => {
  const { api } = setup();
  for (const [error, type] of [
    [new AiIndexNotFoundError('index'), 'NotFoundError'],
    [new InvalidSignalWindowError('Bad original window'), 'ValidationError'],
  ] as const) {
    buildContext.mockRejectedValueOnce(error);
    await expect(
      new FeedbackContextStep(api).run(
        'run',
        {},
        {
          handlerContext: createMockStepContext({ input: { ai_index_id: 'index' }, esClient: {} }),
        }
      )
    ).rejects.toMatchObject({ type, message: error.message });
  }
});

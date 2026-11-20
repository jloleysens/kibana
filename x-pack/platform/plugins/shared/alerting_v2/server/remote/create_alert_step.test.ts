/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createHash } from 'node:crypto';
import { MessageChannel } from 'node:worker_threads';
import type { KibanaRequest } from '@kbn/core/server';
import { expose, openPortSession } from '@kbn/core-remote-common';
import { ExecutionError } from '@kbn/workflows/server';
import type { CreateAlertEventData } from '@kbn/alerting-v2-schemas/src/create_alert_event_data_schema';
import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import {
  alertEpisodeStatus,
  alertEventStatus,
  alertEventType,
} from '../resources/datastreams/alert_events';
import { CreateAlertStep } from './create_alert_step';
import { ScopedAlertEventStorage } from './storage';
import type { AlertEventStorageApi } from './tokens';

const request = { headers: { authorization: 'not-exported' } } as unknown as KibanaRequest;
const input = { source: 'datadog', fingerprint: 'fp-1', alert_status: 'active' as const };

const handlerContext = (abortSignal = new AbortController().signal): StepHandlerContext =>
  ({
    input,
    rawInput: {},
    config: {},
    stepId: 'create-alert',
    stepType: 'alerting.create_alert',
    abortSignal,
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    contextManager: {
      getFakeRequest: () => {
        throw new Error('Alert creation must not read a worker request');
      },
    },
  } as unknown as StepHandlerContext);

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('CreateAlertStep', () => {
  it('requires executor-local handler context', async () => {
    const step = new CreateAlertStep({} as AlertEventStorageApi);
    await expect(step.run('scope', {}, {})).rejects.toThrow('executor-local handler context');
  });

  it('runs the original algorithm with the coordinator space and closes the series', async () => {
    const persisted: unknown[] = [];
    let closed = 0;
    const api: AlertEventStorageApi = {
      canWrite: async () => true,
      parse: async (_scopeId, value) => value as CreateAlertEventData,
      open: async () => ({ reference: 'series', spaceId: 'space-a' }),
      readLatest: async () => [],
      persist: async (_scopeId, _reference, doc) => {
        persisted.push(doc);
      },
      close: async () => {
        closed += 1;
      },
    };
    const result = await new CreateAlertStep(api).run(
      'scope',
      {},
      { handlerContext: handlerContext() }
    );
    const groupHash = sha256('space-a:datadog:fp-1');
    expect(result).toEqual({ output: { group_hash: groupHash, alert_id: expect.any(String) } });
    expect(persisted).toEqual([
      expect.objectContaining({
        group_hash: groupHash,
        space_id: 'space-a',
        status: alertEventStatus.breached,
        source: 'datadog',
        type: alertEventType.alert,
        alert: expect.objectContaining({ status: alertEpisodeStatus.active }),
      }),
    ]);
    expect(closed).toBe(1);
  });

  it('keeps original privilege-before-client order', async () => {
    const open = jest.fn();
    const api: AlertEventStorageApi = {
      canWrite: async () => false,
      parse: async (_scopeId, value) => value as CreateAlertEventData,
      open,
      readLatest: async () => [],
      persist: async () => {},
      close: async () => {},
    };
    const error = await new CreateAlertStep(api)
      .run('scope', {}, { handlerContext: handlerContext() })
      .catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(ExecutionError);
    expect(error).toMatchObject({ type: 'PermissionError' });
    expect(open).not.toHaveBeenCalled();
  });

  it('preserves the public error name and strips private authorization over serialized RPC', async () => {
    const readLatest = jest.fn(async () => []);
    const source = Object.assign(new TypeError('index failed'), {
      name: 'ResponseError',
      authorization: 'secret',
      headers: { authorization: 'secret' },
    });
    readLatest.mockRejectedValue(source);
    const scopes = {
      getRunDefinitionFacts: () => ({}),
      getRunState: () => ({
        workflowRunId: 'run',
        workflowId: 'workflow',
        workflowName: 'Workflow',
        spaceId: 'space-a',
        admittedChildren: new Set<string>(),
      }),
      resolveStepType: () => 'alerting.create_alert',
      resolveStepOutputLimit: () => 1000,
      admitChild: () => {},
      get: () => request,
      getAbortSignal: () => new AbortController().signal,
    };
    const api = new ScopedAlertEventStorage(scopes, {
      canWrite: async () => true,
      getStorage: () =>
        ({
          spaceId: 'space-a',
          readLatest,
          persist: async () => {},
        } as never),
    });
    const { port1, port2 } = new MessageChannel();
    openPortSession(port1, expose(api));
    const remote = openPortSession<AlertEventStorageApi>(port2);
    try {
      expect('invoke' in expose(api)).toBe(false);
      const error = await new CreateAlertStep(remote)
        .run('scope', {}, { handlerContext: handlerContext() })
        .catch((caught: Error) => caught);
      expect(error).toBeInstanceOf(ExecutionError);
      expect(error).toMatchObject({
        type: 'ApiError',
        message: 'index failed',
        details: { name: 'ResponseError', message: 'index failed' },
      });
      expect(JSON.stringify(error)).not.toContain('secret');
      expect(error).not.toHaveProperty('authorization');
      expect(source.authorization).toBe('secret');
      expect(source.name).toBe('ResponseError');
    } finally {
      port1.close();
      port2.close();
    }
  });

  it('rejects a reserved source with the original schema before querying', async () => {
    const readLatest = jest.fn(async () => []);
    const scopes = {
      getRunDefinitionFacts: () => ({}),
      getRunState: () => ({
        workflowRunId: 'run',
        workflowId: 'workflow',
        workflowName: 'Workflow',
        spaceId: 'space-a',
        admittedChildren: new Set<string>(),
      }),
      resolveStepType: () => 'alerting.create_alert',
      resolveStepOutputLimit: () => 1000,
      admitChild: () => {},
      get: () => request,
      getAbortSignal: () => new AbortController().signal,
    };
    const api = new ScopedAlertEventStorage(scopes, {
      canWrite: async () => true,
      getStorage: () =>
        ({
          spaceId: 'space-a',
          readLatest,
          persist: async () => {},
        } as never),
    });
    const context = handlerContext();
    context.input = { source: 'elastic_monitoring', fingerprint: 'fp-1' };
    const error = await new CreateAlertStep(api)
      .run('scope', {}, { handlerContext: context })
      .catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(ExecutionError);
    expect(error).toMatchObject({ type: 'ValidationError' });
    expect(readLatest).not.toHaveBeenCalled();
  });
});

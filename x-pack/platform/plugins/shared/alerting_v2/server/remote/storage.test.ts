/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { getGroupHash } from '../lib/alert_events_client/alert_event_algorithms';
import type { AlertEventStorage } from '../lib/alert_events_client/alert_event_storage';
import {
  alertEventStatus,
  alertEventType,
  alertEpisodeStatus,
  type AlertEventDocument,
} from '../resources/datastreams/alert_events';
import { restoreAlertEventError } from './errors';
import { ScopedAlertEventStorage } from './storage';

const event = { source: 'datadog', fingerprint: 'fp-1' };
const request = { headers: { authorization: 'not-exported' } } as unknown as KibanaRequest;

const createHarness = ({
  spaceId = 'space-a',
  storageSpaceId = 'space-a',
  canWrite = async () => true,
  signal = new AbortController().signal,
  lookup = () => request,
}: {
  spaceId?: string;
  storageSpaceId?: string;
  canWrite?: (request: KibanaRequest) => Promise<boolean>;
  signal?: AbortSignal;
  lookup?: () => KibanaRequest;
} = {}) => {
  const readLatest = jest.fn(async (_groupHash: string, _abortSignal?: AbortSignal) => []);
  const persist = jest.fn(async (_doc: AlertEventDocument) => {});
  const inner = {
    spaceId: storageSpaceId,
    readLatest,
    persist,
  };
  const scopes: ScopeLookup = {
    getRunDefinitionFacts: () => ({}),
    getRunState: (scopeId) => {
      if (scopeId !== 'scope') throw new Error('unknown scope');
      return {
        workflowRunId: 'run',
        workflowId: 'workflow',
        workflowName: 'Workflow',
        spaceId,
        admittedChildren: new Set<string>(),
      };
    },
    resolveStepType: () => 'alerting.create_alert',
    resolveStepOutputLimit: () => 1000,
    admitChild: () => {},
    get: <T>(scopeId: string) => {
      if (scopeId !== 'scope') throw new Error('unknown scope');
      return lookup() as unknown as T;
    },
    getAbortSignal: (scopeId) => {
      if (scopeId !== 'scope') throw new Error('unknown scope');
      return signal;
    },
  };
  const seenRequests: KibanaRequest[] = [];
  const api = new ScopedAlertEventStorage(scopes, {
    canWrite: async (candidate) => {
      seenRequests.push(candidate);
      return canWrite(candidate);
    },
    getStorage: () => inner as unknown as AlertEventStorage,
  });
  return { api, readLatest, persist, seenRequests };
};

const document = (groupHash: string, spaceId: string): AlertEventDocument => ({
  scheduled_timestamp: '2026-01-01T00:00:00.000Z',
  group_hash: groupHash,
  data: {},
  status: alertEventStatus.breached,
  source: 'datadog',
  type: alertEventType.alert,
  alert: { id: 'episode', status: alertEpisodeStatus.active },
  space_id: spaceId,
});

describe('ScopedAlertEventStorage', () => {
  it('queries and stores the coordinator space series, ignoring a worker hash and space', async () => {
    const { api, readLatest, persist } = createHarness();
    const opened = await api.open('scope');
    expect(opened.spaceId).toBe('space-a');

    await api.readLatest('scope', opened.reference, event);

    const coordinatorHash = getGroupHash(event, 'space-a');
    expect(readLatest).toHaveBeenCalledWith(coordinatorHash, expect.any(AbortSignal));
    expect(readLatest.mock.calls[0][0]).not.toBe(getGroupHash(event, 'forged-space'));

    await api.persist(
      'scope',
      opened.reference,
      document(getGroupHash(event, 'forged-space'), 'forged-space')
    );

    expect(persist).toHaveBeenCalledWith({
      scheduled_timestamp: '2026-01-01T00:00:00.000Z',
      group_hash: coordinatorHash,
      data: {},
      status: alertEventStatus.breached,
      source: 'datadog',
      type: alertEventType.alert,
      alert: { id: 'episode', status: alertEpisodeStatus.active },
      space_id: 'space-a',
    });
  });

  it('refuses a storage scope that does not match the workflow space', async () => {
    const { api, readLatest } = createHarness({ storageSpaceId: 'other-space' });
    await expect(api.open('scope')).rejects.toThrow('workflow space');
    expect(readLatest).not.toHaveBeenCalled();
  });

  it('refuses to open when the coordinator privilege check fails', async () => {
    const { api, readLatest } = createHarness({ canWrite: async () => false });
    await expect(api.canWrite('scope')).resolves.toBe(false);
    await expect(api.open('scope')).rejects.toThrow('Insufficient privileges');
    expect(readLatest).not.toHaveBeenCalled();
  });

  it('uses the coordinator request for privilege checks', async () => {
    const { api, seenRequests } = createHarness();
    await api.canWrite('scope');
    expect(seenRequests).toEqual([request]);
  });

  it('rejects a second read, a write before read, a second write, and a foreign scope', async () => {
    const { api } = createHarness();
    const opened = await api.open('scope');
    await api.readLatest('scope', opened.reference, event);
    await expect(api.readLatest('scope', opened.reference, event)).rejects.toThrow('already read');
    const other = await api.open('scope');
    await expect(
      api.persist('scope', other.reference, document(getGroupHash(event, 'space-a'), 'space-a'))
    ).rejects.toThrow('has not been read');
    await expect(api.readLatest('other-scope', opened.reference, event)).rejects.toThrow('scope');
    await api.readLatest('scope', other.reference, event);
    await api.persist(
      'scope',
      other.reference,
      document(getGroupHash(event, 'space-a'), 'space-a')
    );
    await expect(
      api.persist('scope', other.reference, document(getGroupHash(event, 'space-a'), 'space-a'))
    ).rejects.toThrow('already persisted');
  });

  it('releases the series when the scope aborts and still allows close', async () => {
    const controller = new AbortController();
    let querySignal: AbortSignal | undefined;
    const { api, readLatest } = createHarness({ signal: controller.signal });
    readLatest.mockImplementation(
      (_groupHash, abortSignal) =>
        new Promise((_resolve, reject) => {
          querySignal = abortSignal;
          abortSignal?.addEventListener('abort', () => reject(new Error('query aborted')), {
            once: true,
          });
        })
    );
    const opened = await api.open('scope');
    const pending = api.readLatest('scope', opened.reference, event);
    controller.abort();
    await expect(pending).rejects.toThrow('query aborted');
    expect(querySignal?.aborted).toBe(true);
    await expect(api.close('scope', opened.reference)).resolves.toBeUndefined();
  });

  it('strips private error fields and restores the public error name', async () => {
    const { api } = createHarness();
    const opened = await api.open('scope');
    const { readLatest } = createHarness();
    void readLatest;
    const harness = createHarness();
    harness.readLatest.mockRejectedValue(
      Object.assign(new Error('index failed'), {
        name: 'ResponseError',
        authorization: 'secret',
      })
    );
    const openedAgain = await harness.api.open('scope');
    const error = await restoreAlertEventError(
      harness.api.readLatest('scope', openedAgain.reference, event)
    ).catch((caught: Error) => caught);
    expect(error).toMatchObject({ name: 'ResponseError', message: 'index failed' });
    expect(error).not.toHaveProperty('authorization');
    expect(opened.reference).not.toBe(openedAgain.reference);
  });

  it('does not publish a series when the scope aborts before the listener is attached', async () => {
    let checks = 0;
    const signal = {
      aborted: false,
      reason: new Error('Alert storage scope aborted'),
      onabort: null,
      throwIfAborted(this: { aborted: boolean; reason: Error }) {
        if (this.aborted) throw this.reason;
        checks += 1;
        if (checks === 2) this.aborted = true;
      },
      addEventListener(type: string, listener: () => void) {
        if (type === 'abort' && this.aborted) listener();
      },
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
    };
    const { api, readLatest } = createHarness({ signal: signal as unknown as AbortSignal });
    await expect(api.open('scope')).rejects.toThrow('Alert storage scope aborted');
    expect(readLatest).not.toHaveBeenCalled();
    expect(checks).toBe(2);
  });

  it('drops the series on close after the scope lookup has been disposed', async () => {
    let closed = false;
    let querySignal: AbortSignal | undefined;
    const { api, readLatest } = createHarness({
      lookup: () => {
        if (closed) throw new Error('Scope does not belong to this remote host');
        return request;
      },
    });
    readLatest.mockImplementation(async (_groupHash, abortSignal) => {
      querySignal = abortSignal;
      return [];
    });
    const opened = await api.open('scope');
    await api.readLatest('scope', opened.reference, event);
    closed = true;
    await expect(api.close('scope', opened.reference)).resolves.toBeUndefined();
    expect(querySignal?.aborted).toBe(true);
    await expect(
      api.persist('scope', opened.reference, document(getGroupHash(event, 'space-a'), 'space-a'))
    ).rejects.toThrow('Scope does not belong to this remote host');
  });
});

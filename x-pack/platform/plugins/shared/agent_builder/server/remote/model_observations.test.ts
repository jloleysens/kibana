/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { MessageChannel } from 'node:worker_threads';
import { expose, openPortSession } from '@kbn/core-remote-common';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { loggerMock } from '@kbn/logging-mocks';
import { createModelObservations } from './model_observations';
import type { ModelObservationsApi } from './model_observations_api';

const metadata = {
  pluginId: 'nightshift-investigation-memory',
  interactionId: 'coordinator-run',
  spaceId: 'ops',
  userId: 'profile',
};
const completion = { model: 'response-model', tokens: { prompt: 2, completion: 3, total: 5 } };
const setup = () => {
  const controller = new AbortController();
  const scopes: ScopeLookup = {
    get: jest.fn(),
    getRunState: jest.fn(),
    resolveStepType: jest.fn().mockReturnValue('nightshift.cortexOptimize'),
    resolveStepOutputLimit: jest.fn(),
    getRunDefinitionFacts: jest.fn(() => ({})),
    admitChild: jest.fn(),
    getAbortSignal: (scopeId) => {
      if (scopeId !== 'run') throw new Error('Foreign scope');
      return controller.signal;
    },
  };
  const logger = loggerMock.create();
  const service = createModelObservations(scopes, logger);
  const complete = jest.fn();
  service.issue('run', 'step', 'registered', { metadata, complete });
  return { ...service, controller, scopes, logger, complete };
};

it('returns only this registered model metadata and tracks each completion once', async () => {
  const { api, complete } = setup();
  const first = await api.open('run', 'step', 'registered');
  expect(first.metadata).toEqual(metadata);
  await Promise.all([
    api.report('run', first.lease, completion),
    api.report('run', first.lease, completion),
  ]);
  expect(complete).toHaveBeenCalledTimes(1);
  expect(complete).toHaveBeenCalledWith(completion);
  const second = await api.open('run', 'step', 'registered');
  await api.report('run', second.lease, {});
  expect(complete).toHaveBeenCalledTimes(2);
});

it('refuses an unregistered connector, step, scope and changed coordinator step type', async () => {
  const { api, scopes } = setup();
  await expect(api.open('run', 'step', 'forged')).rejects.toThrow('not registered');
  await expect(api.open('run', 'unknown', 'registered')).rejects.toThrow('not registered');
  await expect(api.open('foreign', 'step', 'registered')).rejects.toThrow('Foreign scope');
  scopes.resolveStepType = () => 'nightshift.memoryOptimize';
  await expect(api.open('run', 'step', 'registered')).rejects.toThrow('not registered');
});

it('drops forged and other-scope leases without consuming the legitimate lease', async () => {
  const { api, complete } = setup();
  const { lease } = await api.open('run', 'step', 'registered');
  await api.report('run', 'forged', completion);
  await api.report('foreign', lease, completion);
  expect(complete).not.toHaveBeenCalled();
  await api.report('run', lease, completion);
  expect(complete).toHaveBeenCalledTimes(1);
});

it.each([
  { ...completion, connectorId: 'forged' },
  { ...completion, provider: 'forged' },
  { ...completion, workflowRunId: 'forged' },
  { ...completion, metadata: { ...metadata, interactionId: 'foreign' } },
  { model: 'm'.repeat(501) },
  { tokens: { prompt: -1, completion: 1, total: 0 } },
  { tokens: { prompt: 0.5, completion: 1, total: 1.5 } },
  { tokens: { prompt: Infinity, completion: 1, total: Infinity } },
  { tokens: { prompt: Number.MAX_SAFE_INTEGER + 1, completion: 1, total: 1 } },
  { tokens: { prompt: 0, completion: 1, total: 1, secret: 'no' } },
])('rejects malformed or resource/provenance-bearing observations %#', async (event) => {
  const { api, complete } = setup();
  const { lease } = await api.open('run', 'step', 'registered');
  await api.report('run', lease, event);
  await api.report('run', lease, completion);
  expect(complete).not.toHaveBeenCalled();
  const next = await api.open('run', 'step', 'registered');
  expect(next.metadata).toEqual(metadata);
});

it('settles registrations and drops late reports after settle and scope close', async () => {
  const { api, complete, controller } = setup();
  const { lease } = await api.open('run', 'step', 'registered');
  await api.settle('run', 'step');
  await api.report('run', lease, completion);
  await expect(api.open('run', 'step', 'registered')).rejects.toThrow('not registered');
  controller.abort();
  await api.report('run', lease, completion);
  expect(complete).not.toHaveBeenCalled();
});

it('does not fail execution if the original telemetry tracker throws', async () => {
  const { api, complete } = setup();
  complete.mockImplementation(() => {
    throw new Error('tracking offline');
  });
  const { lease } = await api.open('run', 'step', 'registered');
  await expect(api.report('run', lease, completion)).resolves.toBeUndefined();
});

it('does not expose the coordinator-only issuer over the real RPC transport', async () => {
  const { api, complete } = setup();
  const { port1, port2 } = new MessageChannel();
  openPortSession(port1, expose(api));
  const session = openPortSession<ModelObservationsApi>(port2);
  try {
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(api)).sort()).toEqual([
      'constructor',
      'open',
      'report',
      'settle',
    ]);
    const { lease, metadata: returned } = await session.open('run', 'step', 'registered');
    expect(returned).toEqual(metadata);
    await session.report('run', lease, completion);
    expect(complete).toHaveBeenCalledWith(completion);
  } finally {
    port1.close();
    port2.close();
  }
});

it('keeps registrations host-private even when nested parent/child hosts share Core ScopeLookup', async () => {
  const parent = setup();
  const child = createModelObservations(parent.scopes, parent.logger);
  const { lease } = await parent.api.open('run', 'step', 'registered');
  await expect(child.api.open('run', 'step', 'registered')).rejects.toThrow('not registered');
  await child.api.report('run', lease, completion);
  expect(parent.complete).not.toHaveBeenCalled();
  await parent.api.report('run', lease, completion);
  expect(parent.complete).toHaveBeenCalledTimes(1);
});

it('drains host-private leases and registrations and drops pending reports after host teardown', async () => {
  const host = setup();
  const { lease } = await host.api.open('run', 'step', 'registered');
  host.drain();
  await host.api.report('run', lease, completion);
  await expect(host.api.open('run', 'step', 'registered')).rejects.toThrow('drained');
  expect(() =>
    host.issue('run', 'step', 'registered', { metadata, complete: host.complete })
  ).toThrow('drained');
  expect(host.complete).not.toHaveBeenCalled();
  host.controller.abort();
});

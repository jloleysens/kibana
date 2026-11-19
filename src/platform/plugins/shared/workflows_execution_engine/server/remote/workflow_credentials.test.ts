/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { coreMock, httpServerMock } from '@kbn/core/server/mocks';
import { WorkflowCredentials } from './workflow_credentials';

it('shares only in-flight scoped refreshes, strips extra secret fields, and forwards scope cancellation', async () => {
  const core = coreMock.createStart();
  const request = httpServerMock.createKibanaRequest({
    headers: { authorization: 'Bearer essu_expired' },
  });
  const controller = new AbortController();
  const refresh = jest.mocked(core.http.selfClient.refreshRunCredential);
  const credential = {
    authorization: 'Bearer essu_fresh',
    uiamAttestation: 'bound',
    refreshToken: 'never-export',
    masterKey: 'never-export',
  };
  let finish: (value: typeof credential) => void = () => {};
  refresh.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const scopes = {
    get: jest.fn().mockReturnValue(request),
    getAbortSignal: () => controller.signal,
  };
  const api = new WorkflowCredentials(core, scopes);
  const first = api.refreshRunCredential('scope');
  const second = api.refreshRunCredential('scope');
  expect(first).toBe(second);
  expect(core.http.selfClient.refreshRunCredential).toHaveBeenCalledTimes(1);
  expect(core.http.selfClient.refreshRunCredential).toHaveBeenCalledWith(
    request,
    controller.signal
  );
  finish(credential);
  expect(await first).toEqual({ authorization: 'Bearer essu_fresh', uiamAttestation: 'bound' });
  expect(JSON.stringify(await second)).not.toMatch(/refreshToken|masterKey|never-export/);
  refresh.mockResolvedValue(undefined);
  expect(await api.refreshRunCredential('scope')).toBeNull();
  expect(core.http.selfClient.refreshRunCredential).toHaveBeenCalledTimes(2);
  controller.abort();
  expect(() => api.refreshRunCredential('scope')).toThrow();
  expect(core.http.selfClient.refreshRunCredential).toHaveBeenCalledTimes(2);
});

it('aborts an in-flight Core refresh waiter when its owning scope closes', async () => {
  const core = coreMock.createStart();
  const request = httpServerMock.createKibanaRequest();
  const controller = new AbortController();
  jest.mocked(core.http.selfClient.refreshRunCredential).mockImplementation(
    (_request, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })
  );
  const api = new WorkflowCredentials(core, {
    get: jest.fn().mockReturnValue(request),
    getAbortSignal: () => controller.signal,
  });
  const pending = api.refreshRunCredential('scope');
  controller.abort(new Error('Scope closed'));
  await expect(pending).rejects.toThrow('Scope closed');
});

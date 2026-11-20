/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { HttpSelfClientDispatchConfig } from '@kbn/core-http-server';
import { CoreKibanaRequest } from '@kbn/core-http-router-server-internal';
import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { UIAM_INTERNAL_CALLER_ATTESTATION_HEADER } from '@kbn/core-security-server';
import { createWorkerHttpService } from './worker_http_service';

const originalFetch = global.fetch;
const config = (): HttpSelfClientDispatchConfig => ({
  target: 'auto',
  basePath: '/base',
  publicBaseUrl: 'https://public.example/base',
  serverInfo: { name: 'worker', hostname: '127.0.0.1', port: 5635, protocol: 'http' },
  kibanaVersion: '9.7.0',
  maxRedirects: 2,
  ssl: {
    local: {
      verificationMode: 'certificate',
      certificateAuthorities: ['public-ca'],
      exclusiveTrust: true,
      clientCertificateRequired: false,
    },
    public: {
      verificationMode: 'full',
      certificateAuthorities: [],
      exclusiveTrust: false,
      clientCertificateRequired: false,
    },
  },
});

beforeEach(() => {
  global.fetch = jest.fn(
    async () => new Response('{}', { headers: { 'content-type': 'application/json' } })
  );
});
afterEach(() => {
  global.fetch = originalFetch;
});

it('reuses original local/public URL, managed-header, same-origin redirect and credential-bound attestation policies', async () => {
  const http = createWorkerHttpService(config(), loggingSystemMock.createLogger(), {
    authorization: 'Bearer run',
    uiamAttestation: 'run-attestation',
  });
  const request = CoreKibanaRequest.from({ path: '/', headers: { authorization: 'Bearer run' } });
  const scoped = http.selfClient.asScoped(request);
  await scoped.fetch('/api/status', { access: 'internal' });
  const sent = (global.fetch as jest.Mock).mock.calls[0][0] as Request;
  expect(sent.url).toBe('https://public.example/base/api/status');
  expect(sent.headers.get('authorization')).toBe('Bearer run');
  expect(sent.headers.get(UIAM_INTERNAL_CALLER_ATTESTATION_HEADER)).toBe('run-attestation');
  expect(sent.headers.get('kbn-version')).toBe('9.7.0');
  expect(sent.headers.get('x-kbn-self-call')).toBe('true');
  await expect(
    scoped.fetch('/api/status', { headers: { authorization: 'override' } })
  ).rejects.toThrow();
  await scoped.fetch('/api/status', { target: 'local' });
  expect(((global.fetch as jest.Mock).mock.calls[1][0] as Request).url).toBe(
    'http://127.0.0.1:5635/base/api/status'
  );
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    new Response(null, { status: 302, headers: { location: 'https://foreign.example/steal' } })
  );
  await expect(scoped.fetch('/api/status')).rejects.toThrow('cross-origin');
  const other = CoreKibanaRequest.from({ path: '/', headers: { authorization: 'Bearer other' } });
  await http.selfClient.asScoped(other).fetch('/api/status');
  expect(
    ((global.fetch as jest.Mock).mock.calls.at(-1)[0] as Request).headers.has(
      UIAM_INTERNAL_CALLER_ATTESTATION_HEADER
    )
  ).toBe(false);
  await http.selfClient.close();
});

it('preserves the coordinator local mTLS refusal instead of exporting listener keys', async () => {
  const snapshot = config();
  const http = createWorkerHttpService(
    {
      ...snapshot,
      ssl: { ...snapshot.ssl, local: { ...snapshot.ssl.local, clientCertificateRequired: true } },
    },
    loggingSystemMock.createLogger(),
    { authorization: 'ApiKey run' }
  );
  const request = CoreKibanaRequest.from({ path: '/', headers: { authorization: 'ApiKey run' } });
  await expect(
    http.selfClient.asScoped(request).fetch('/api/status', { target: 'local' })
  ).rejects.toThrow('clientAuthentication is required');
  expect(global.fetch).not.toHaveBeenCalled();
  await http.selfClient.close();
});

it.each(['/api/cases', '/api/note'])(
  'refreshes a rejected scoped bearer once for %s and stamps its new bound attestation',
  async (path) => {
    global.fetch = jest.fn(async (request: Parameters<typeof global.fetch>[0]) =>
      new Request(request).headers.get('authorization') === 'Bearer essu_expired'
        ? new Response('{}', { status: 401, headers: { 'x-kbn-self-call-auth-challenge': 'true' } })
        : new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
    );
    const refresh = jest.fn(async () => ({
      authorization: 'Bearer essu_fresh',
      uiamAttestation: 'fresh-attestation',
    }));
    const http = createWorkerHttpService(
      config(),
      loggingSystemMock.createLogger(),
      { authorization: 'Bearer essu_expired' },
      refresh
    );
    const request = CoreKibanaRequest.from({
      path: '/',
      headers: { authorization: 'Bearer essu_expired' },
    });
    expect(await http.selfClient.asScoped(request).fetch(path)).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const retry = (global.fetch as jest.Mock).mock.calls[1][0] as Request;
    expect(retry.headers.get('authorization')).toBe('Bearer essu_fresh');
    expect(retry.headers.get(UIAM_INTERNAL_CALLER_ATTESTATION_HEADER)).toBe('fresh-attestation');
    await http.selfClient.close();
  }
);

it('shares an in-flight refresh across concurrent authentication-stage 401s without retry loops', async () => {
  global.fetch = jest.fn(async (request: Parameters<typeof global.fetch>[0]) =>
    new Request(request).headers.get('authorization') === 'Bearer essu_expired'
      ? new Response('{}', { status: 401, headers: { 'x-kbn-self-call-auth-challenge': 'true' } })
      : new Response('{}', { headers: { 'content-type': 'application/json' } })
  );
  let finish: (credential: { authorization: string }) => void = () => {};
  const refresh = jest.fn(
    () =>
      new Promise<{ authorization: string }>((resolve) => {
        finish = resolve;
      })
  );
  const http = createWorkerHttpService(
    config(),
    loggingSystemMock.createLogger(),
    { authorization: 'Bearer essu_expired' },
    refresh
  );
  const request = CoreKibanaRequest.from({
    path: '/',
    headers: { authorization: 'Bearer essu_expired' },
  });
  const scoped = http.selfClient.asScoped(request);
  const first = scoped.fetch('/api/cases');
  const second = scoped.fetch('/api/note');
  await new Promise((resolve) => setImmediate(resolve));
  expect(refresh).toHaveBeenCalledTimes(1);
  finish({ authorization: 'Bearer essu_fresh' });
  await Promise.all([first, second]);
  expect(global.fetch).toHaveBeenCalledTimes(4);
  await http.selfClient.close();
});

it('never refreshes a route-handler 401 and surfaces refresh failure as the original 401', async () => {
  global.fetch = jest.fn(async () => new Response('{}', { status: 401 }));
  const refresh = jest.fn(async () => {
    throw new Error('refresh unavailable');
  });
  const http = createWorkerHttpService(
    config(),
    loggingSystemMock.createLogger(),
    { authorization: 'Bearer essu_expired' },
    refresh
  );
  const request = CoreKibanaRequest.from({
    path: '/',
    headers: { authorization: 'Bearer essu_expired' },
  });
  await expect(http.selfClient.asScoped(request).fetch('/api/note')).rejects.toThrow('401');
  expect(refresh).not.toHaveBeenCalled();
  global.fetch = jest.fn(
    async () =>
      new Response('{}', { status: 401, headers: { 'x-kbn-self-call-auth-challenge': 'true' } })
  );
  await expect(http.selfClient.asScoped(request).fetch('/api/cases')).rejects.toThrow('401');
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  await http.selfClient.close();
});

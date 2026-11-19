/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import type { HttpSelfClientDispatchConfig } from '@kbn/core-http-server';
import { WorkerHttpProvider } from './worker_http_provider';

let mockFailImport = true;
let mockImports = 0;
const mockCreate = jest.fn(() => ({ selfClient: {} }));
jest.mock('./worker_http_service', () => {
  mockImports++;
  if (mockFailImport) {
    mockFailImport = false;
    throw new Error('import failed');
  }
  return { createWorkerHttpService: mockCreate };
});

it('keeps implementation imports lazy, retries failed imports and shares code but not run identities', async () => {
  const first = new WorkerHttpProvider();
  const second = new WorkerHttpProvider();
  expect(mockImports).toBe(0);
  const config: HttpSelfClientDispatchConfig = {
    target: 'local',
    basePath: '',
    kibanaVersion: '9.7.0',
    maxRedirects: 0,
    serverInfo: { name: 'worker', hostname: '127.0.0.1', port: 5635, protocol: 'http' },
    ssl: {
      local: {
        verificationMode: 'full',
        certificateAuthorities: [],
        exclusiveTrust: false,
        clientCertificateRequired: false,
      },
      public: {
        verificationMode: 'full',
        certificateAuthorities: [],
        exclusiveTrust: false,
        clientCertificateRequired: false,
      },
    },
  };
  const log = loggingSystemMock.createLogger();
  await expect(first.create(config, log, { authorization: 'ApiKey failed' })).rejects.toThrow(
    'import failed'
  );
  expect(mockCreate).not.toHaveBeenCalled();
  const identities = [{ authorization: 'ApiKey first' }, { authorization: 'ApiKey second' }];
  await Promise.all([
    first.create(config, log, identities[0]),
    second.create(config, log, identities[1]),
  ]);
  expect(mockImports).toBe(2);
  expect(mockCreate.mock.calls).toEqual(
    identities.map((identity) => [config, log, identity, undefined])
  );
});

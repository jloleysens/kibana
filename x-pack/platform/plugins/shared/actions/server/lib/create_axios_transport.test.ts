/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { loggerMock } from '@kbn/logging-mocks';
import { AuthTypeRegistry, registerAuthTypes } from '../auth_types';
import { actionsConfigMock } from '../actions_config.mock';
import { createAxiosTransport, createCredentialAccessor } from './create_axios_transport';
import type { AxiosTransportDependencies } from './create_axios_transport';
import type { AxiosAuthStrategy } from './axios_auth_strategies';

// Actions Jest uses jsdom; select the same HTTP adapter used in the Node worker.
const nodeTransport = (dependencies: AxiosTransportDependencies) => {
  const factory = createAxiosTransport(dependencies);
  return async (...args: Parameters<typeof factory>) => {
    const client = await factory(...args);
    client.defaults.adapter = 'http';
    return client;
  };
};

const startServer = async (server: Server): Promise<string> => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  return 'http://127.0.0.1:' + address.port;
};

const closeServer = async (server: Server): Promise<void> => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
};

describe('original isolate-local Axios transport against real HTTP fakes', () => {
  const registry = new AuthTypeRegistry();
  registerAuthTypes(registry);
  let server: Server;
  let url: string;
  let hits: string[];
  const configurationUtilities = actionsConfigMock.create();
  const logger = loggerMock.create();
  const getToken = jest.fn();
  const installResponseInterceptor = jest.fn();
  const strategy: AxiosAuthStrategy = { getToken, installResponseInterceptor };
  const options = {
    authTypeRegistry: registry,
    configurationUtilities,
    logger,
    getAuthStrategy: () => strategy,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    configurationUtilities.getProxySettings.mockReturnValue(undefined);
    configurationUtilities.getResponseSettings.mockReturnValue({
      maxContentLength: 1024,
      timeout: 1000,
    });
    configurationUtilities.ensureHostnameAllowed.mockImplementation(() => {});
    hits = [];
    server = createServer((request, response) => {
      hits.push(request.url ?? '');
      if (request.url === '/redirect') {
        response.writeHead(302, { location: url.replace('127.0.0.1', 'localhost') + '/forbidden' });
        response.end();
      } else if (request.url === '/large') {
        response.end('x'.repeat(2048));
      } else if (request.url === '/wait') {
        // The client must cancel; closeServer tears down the pending socket in finally.
      } else {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({ authorization: request.headers.authorization, path: request.url })
        );
      }
    });
    url = await startServer(server);
    configurationUtilities.ensureUriAllowed.mockImplementation((target) => {
      if (new URL(target).origin !== url) throw new Error('initial target denied');
    });
  });

  afterEach(async () => closeServer(server));

  it('runs original Basic auth locally and checks the resolved relative URL before sending', async () => {
    const secrets = { authType: 'basic', username: 'user', password: 'password' };
    const client = await nodeTransport(options)({ connectorId: 'referenced', secrets });
    const response = await client.get('/business', { baseURL: url });
    expect(response.data).toEqual({
      authorization: 'Basic dXNlcjpwYXNzd29yZA==',
      path: '/business',
    });
    expect(configurationUtilities.ensureUriAllowed).toHaveBeenCalledWith(url + '/business');
    expect(getToken).not.toHaveBeenCalled();
    const credential = createCredentialAccessor(options)({ connectorId: 'referenced', secrets });
    expect(await credential.getAuthHeaders()).toEqual({
      Authorization: 'Basic dXNlcjpwYXNzd29yZA==',
    });
  });

  it('refuses an initial target before network dispatch', async () => {
    const client = await nodeTransport(options)({ connectorId: 'referenced', secrets: {} });
    await expect(client.get(url.replace('127.0.0.1', 'localhost') + '/denied')).rejects.toThrow(
      'initial target denied'
    );
    expect(hits).toEqual([]);
  });

  it('refuses a redirect before contacting the disallowed hostname', async () => {
    configurationUtilities.ensureHostnameAllowed.mockImplementation(() => {
      throw new Error('redirect denied');
    });
    const client = await nodeTransport(options)({ connectorId: 'referenced', secrets: {} });
    await expect(client.get(url + '/redirect')).rejects.toThrow('redirect denied');
    expect(hits).toEqual(['/redirect']);
    expect(configurationUtilities.ensureHostnameAllowed).toHaveBeenCalledWith('localhost');
  });

  it('preserves configured and per-execution response limits', async () => {
    const factory = nodeTransport(options);
    const configured = await factory({ connectorId: 'referenced', secrets: {} });
    await expect(configured.get(url + '/large')).rejects.toThrow('maxContentLength');
    const overridden = await factory({
      connectorId: 'referenced',
      secrets: {},
      maxContentLength: 16,
    });
    await expect(overridden.get(url + '/business')).rejects.toThrow('maxContentLength');
    expect(hits).toEqual(['/large', '/business']);
  });

  it('uses the original configured proxy agent rather than ambient Axios proxy behavior', async () => {
    const proxyHits: string[] = [];
    const proxy = createServer((request, response) => {
      proxyHits.push(request.url ?? '');
      response.end('proxied');
    });
    const proxyUrl = await startServer(proxy);
    try {
      configurationUtilities.getProxySettings.mockReturnValue({
        proxyUrl,
        proxySSLSettings: { verificationMode: 'full' },
        proxyBypassHosts: undefined,
        proxyOnlyHosts: undefined,
      });
      const client = await nodeTransport(options)({
        connectorId: 'referenced',
        secrets: {},
      });
      const response = await client.get(url + '/through-proxy');
      expect(response.data).toBe('proxied');
      expect(proxyHits).toEqual([url + '/through-proxy']);
      expect(hits).toEqual([]);
    } finally {
      await closeServer(proxy);
    }
  });

  it('preserves the real local AbortSignal and timeout limits', async () => {
    const controller = new AbortController();
    const client = await nodeTransport(options)({
      connectorId: 'referenced',
      secrets: {},
      signal: controller.signal,
    });
    const started = once(server, 'request');
    const request = client.get(url + '/wait');
    await started;
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    configurationUtilities.getResponseSettings.mockReturnValue({
      maxContentLength: 1024,
      timeout: 10,
    });
    const bounded = await nodeTransport(options)({ connectorId: 'referenced', secrets: {} });
    await expect(bounded.get(url + '/wait')).rejects.toMatchObject({ code: 'ECONNABORTED' });
  });
});

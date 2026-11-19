/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { SpecRuntime } from '@kbn/actions-plugin/server/remote/spec_runtime';
import type { NativeActionsApi } from '@kbn/actions-plugin/server/remote/types';
import { LeasePool } from '@kbn/actions-plugin/server/lib/lease_pool';
import { actionsMock } from '@kbn/actions-plugin/server/mocks';
import { actionsConfigMock } from '@kbn/actions-plugin/server/actions_config.mock';
import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { McpConnector } from './mcp';

it.each([false, true])(
  'awaits worker-owned original lease eviction after handler failure=%s',
  async (fail) => {
    const actions: NativeActionsApi = {
      prepare: jest.fn(),
      finalize: jest.fn(),
      token: jest.fn(),
      dashboard: jest.fn(),
      relay: jest.fn(),
    };
    const runtime = new SpecRuntime(actions);
    const services = actionsMock.createServices();
    const configurationUtilities = actionsConfigMock.create();
    let evicted = false;
    const evict = jest.spyOn(LeasePool.prototype, 'evict').mockImplementation(async () => {
      await Promise.resolve();
      evicted = true;
    });
    jest.spyOn(runtime, 'runLegacy').mockImplementation(async (connector) => {
      const secrets = connector.schema.secrets.parse({ token: 'fake' });
      if (!secrets) throw new Error('Missing test secrets');
      const service = connector.getService({
        connector: { id: 'saved', type: '.mcp' },
        config: connector.schema.config.parse({
          serverUrl: 'http://127.0.0.1',
          hasAuth: true,
          authType: 'bearer',
        }),
        secrets,
        services,
        configurationUtilities,
        logger: loggingSystemMock.createLogger(),
        connectorVersion: 'version',
      });
      expect([...service.getSubActions().keys()]).toEqual(['test', 'listTools', 'callTool']);
      if (fail) throw new Error('handler failed');
      return { status: 'ok' };
    });
    try {
      const result = new McpConnector(runtime, { user: () => services.scopedClusterClient }).run(
        'scope',
        {},
        {}
      );
      if (fail) await expect(result).rejects.toThrow('handler failed');
      else await expect(result).resolves.toEqual({ status: 'ok' });
      expect(evict).toHaveBeenCalledWith('saved');
      expect(evicted).toBe(true);
    } finally {
      jest.restoreAllMocks();
    }
  }
);

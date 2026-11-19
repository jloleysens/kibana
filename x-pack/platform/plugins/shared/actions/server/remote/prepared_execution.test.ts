/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { ConnectorUsageCollector } from '../usage/connector_usage_collector';
import { actionsClientMock } from '../actions_client/actions_client.mock';
import { actionsConfigMock } from '../actions_config.mock';
import { actionsMock } from '../mocks';
import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { PreparedExecution } from './prepared_execution';
import { configSchema } from '../config';
import { serializeActionsConfiguration } from '../actions_config';
import type { ActionRuntimeOptions, ActionRuntimeResult } from '../lib/execute_action';

it.each(['ears', 'bearer'])(
  'never exports deployment EARS certificate/key paths for %s invocations',
  async (authType) => {
    const client = actionsClientMock.create();
    const configurationUtilities = actionsConfigMock.create();
    configurationUtilities.getEARSSSLSettings.mockReturnValue({
      cert: Buffer.from('deployment-cert'),
      key: Buffer.from('deployment-private-key'),
    });
    const options: ActionRuntimeOptions = {
      actionId: 'connector',
      name: 'Slack',
      actionType: {
        id: '.slack2',
        name: 'Slack',
        minimumLicenseRequired: 'enterprise',
        supportedFeatureIds: [],
        validate: {
          config: { schema: z.object({}) },
          secrets: { schema: z.object({}).passthrough() },
        },
      },
      config: {},
      secrets: { authType, provider: 'slack' },
      params: { subAction: 'whoAmI', subActionParams: {} },
      configurationUtilities,
      logger: loggingSystemMock.createLogger(),
      services: actionsMock.createServices(),
      connectorUsageCollector: new ConnectorUsageCollector({
        logger: loggingSystemMock.createLogger(),
        connectorId: 'connector',
      }),
      runtimeConfig: serializeActionsConfiguration(
        configSchema.validate({
          auth: {
            ears: {
              enabled: true,
              url: 'https://ears.invalid',
              ssl: { certificate: '/coordinator/cert.pem', key: '/coordinator/private.pem' },
            },
          },
        })
      ),
    };
    client.executeWithRuntime.mockImplementation(
      async (_request, continuation) => (await continuation.execute(options)).result
    );
    const controller = new AbortController();
    const execution = new PreparedExecution(client, 'connector', 'slack2', {}, controller.signal);
    const result = await execution.preparation;
    expect('prepared' in result).toBe(true);
    if (!('prepared' in result)) throw new Error('Expected prepared connector');
    expect(result.prepared.runtimeConfig.auth.ears?.ssl).toBeUndefined();
    expect(result.prepared.earsTransportAvailable).toBe(authType === 'ears');
    expect(JSON.stringify(result)).not.toContain('/coordinator/');
    expect(JSON.stringify(result)).not.toContain('deployment-private-key');
    if (authType === 'bearer')
      expect(configurationUtilities.getEARSSSLSettings).not.toHaveBeenCalled();
    const runtime: ActionRuntimeResult = {
      result: { status: 'ok', actionId: 'connector' },
      validatedParams: {},
      errorType: 'other',
      executionStartedAt: 1,
      executionCompletedAt: 2,
      handlerStarted: true,
    };
    await execution.finalize(runtime);
  }
);

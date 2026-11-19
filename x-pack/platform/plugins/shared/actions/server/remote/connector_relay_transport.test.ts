/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  connectorsSpecs,
  authTypeSpecs,
  isConnectorAuthorizationError,
  type NormalizedAuthType,
} from '@kbn/connector-specs';
import { loggerMock } from '@kbn/logging-mocks';
import { actionsConfigMock } from '../actions_config.mock';
import { serializeActionsConfiguration } from '../actions_config';
import { configSchema } from '../config';
import { RelayClient } from '../lib/relay/relay_client';
import { request } from '../lib/axios_utils';
import { ConnectorRelayTransport } from './connector_relay_transport';
import { createConnectorRelayClient } from './connector_relay_client';
import { SpecRuntime } from './spec_runtime_impl';
import type { NativeActionsApi, PreparedConnector } from './types';

jest.mock('../lib/axios_utils');
const requestMock = jest.mocked(request);

const setup = (useSystemIdentity = false, subAction = 'sendMessage') => {
  const signal = new AbortController();
  const configurationUtilities = actionsConfigMock.create();
  const ssl = {
    verificationMode: 'full' as const,
    cert: Buffer.from('coordinator certificate'),
    key: Buffer.from('coordinator PRIVATE KEY'),
  };
  configurationUtilities.getRelaySSLSettings.mockReturnValue(ssl);
  const createEphemeralToken = jest.fn(async () => 'coordinator-system-token');
  const client = new RelayClient({
    baseUrl: 'https://relay.example',
    configurationUtilities,
    logger: loggerMock.create(),
    useSystemIdentity,
    getSystemIdentity: () => ({ createEphemeralToken }),
  });
  const prepared: PreparedConnector = {
    kibanaVersion: '9.7.0',
    actionId: 'referenced',
    actionTypeId: '.slack2',
    name: 'Slack',
    config: { selectedActions: [subAction] },
    secrets: { authType: 'relay', tenantKey: 'prepared-tenant' },
    params: { subAction, subActionParams: { channel: 'C123', text: 'local outcome' } },
    runtimeConfig: serializeActionsConfiguration(
      configSchema.validate({ allowedHosts: ['relay.example'] })
    ),
    relayAvailable: true,
  };
  const transport = new ConnectorRelayTransport(
    client,
    {
      actionType: { id: prepared.actionTypeId },
      config: prepared.config,
      secrets: prepared.secrets,
      params: prepared.params,
    },
    signal.signal
  );
  const relay = jest.fn<
    ReturnType<NativeActionsApi['relay']>,
    Parameters<NativeActionsApi['relay']>
  >(async (_scope, _invocation, input) => transport.execute(input));
  const actions: NativeActionsApi = {
    prepare: jest.fn(async () => ({ prepared })),
    token: jest.fn(),
    relay,
    finalize: jest.fn(async () => {}),
  };
  return { actions, prepared, transport, signal, createEphemeralToken, ssl };
};

beforeEach(() => jest.clearAllMocks());

it.each([false, true])(
  'runs the original Slack handler around coordinator-only Relay authentication (UIAM=%s)',
  async (useSystemIdentity) => {
    const { actions, prepared, createEphemeralToken, ssl } = setup(useSystemIdentity);
    requestMock.mockResolvedValue({
      status: 200,
      data: { ref: '123.45', channel: 'C123', origin: { external_conversation_id: 'thread' } },
    } as never);
    const runtime = new SpecRuntime(actions);
    await expect(
      runtime.run(
        connectorsSpecs.Slack,
        {
          authTypes: [authTypeSpecs.RelayAuth as NormalizedAuthType],
          isConnectorAuthorizationError,
        },
        'scope',
        {
          connectorType: 'slack2',
          connectorNameOrId: 'referenced',
          system: false,
          input: prepared.params,
        }
      )
    ).resolves.toEqual({
      status: 'ok',
      actionId: 'referenced',
      data: { ok: true, channel: 'C123', ts: '123.45', externalConversationId: 'thread' },
    });
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://relay.example/v1/slack/trigger',
        sslOverrides: ssl,
        headers: {
          'Content-Type': 'application/json',
          ...(useSystemIdentity ? { Authorization: 'Bearer coordinator-system-token' } : {}),
        },
        data: { tenant_key: 'prepared-tenant', channel: 'C123', message: 'local outcome' },
      })
    );
    expect(createEphemeralToken).toHaveBeenCalledTimes(useSystemIdentity ? 1 : 0);
    const crossing = JSON.stringify({
      prepared,
      requests: jest.mocked(actions.relay).mock.calls,
      response: await jest.mocked(actions.relay).mock.results[0].value,
    });
    expect(crossing).not.toContain('coordinator-system-token');
    expect(crossing).not.toContain('PRIVATE KEY');
    await runtime.close('scope');
    expect(actions.finalize).toHaveBeenCalledTimes(1);
  }
);

it('pins the tenant and preserves blocks, pagination and structured HTTP status without exposing credentials/errors', async () => {
  const { actions, transport } = setup(true);
  const client = createConnectorRelayClient(actions, 'scope', 'invocation');
  requestMock.mockResolvedValueOnce({ status: 200, data: { ref: '1', channel: 'C123' } } as never);
  await client.trigger({
    tenantKey: 'forged',
    channel: 'C123',
    message: 'hello',
    blocks: [{ type: 'divider' }],
  });
  expect(requestMock).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: {
        tenant_key: 'prepared-tenant',
        channel: 'C123',
        message: 'hello',
        blocks: [{ type: 'divider' }],
      },
    })
  );
  requestMock.mockResolvedValueOnce({
    status: 200,
    data: { bindings: [{ scope_id: 'C123', display_name: 'general' }], next_cursor: 'cursor' },
  } as never);
  await expect(client.listBindings('forged', { limit: 10, cursor: 'page' })).resolves.toEqual({
    bindings: [{ scope_id: 'C123', display_name: 'general' }],
    nextCursor: 'cursor',
  });
  expect(requestMock).toHaveBeenLastCalledWith(
    expect.objectContaining({
      url: expect.stringContaining('/tenants/prepared-tenant/bindings?limit=10&cursor=page'),
    })
  );
  requestMock.mockResolvedValueOnce({
    status: 403,
    data: { message: 'coordinator-system-token PRIVATE KEY' },
  } as never);
  const error = await transport.execute({
    operation: 'trigger',
    input: { channel: 'C123', message: 'hi' },
  });
  expect(error).toEqual({ error: { statusCode: 403 } });
  requestMock.mockRejectedValueOnce(new Error('coordinator-system-token PRIVATE KEY'));
  await expect(transport.execute({ operation: 'listBindings' })).resolves.toEqual({ error: {} });
});

it('refuses posting from read-only prepared operations, oversized inputs, closure and cancellation', async () => {
  const { transport, signal } = setup(false, 'listChannels');
  await expect(
    transport.execute({ operation: 'trigger', input: { channel: 'C123', message: 'hi' } })
  ).rejects.toThrow('cannot post');
  await expect(
    transport.execute({ operation: 'listBindings', options: { limit: 201 } })
  ).rejects.toThrow();
  expect(requestMock).not.toHaveBeenCalled();
  transport.close();
  await expect(transport.execute({ operation: 'listBindings' })).rejects.toThrow('not available');
  signal.abort();
  await expect(transport.execute({ operation: 'listBindings' })).rejects.toThrow();
});

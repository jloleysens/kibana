/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RelayActionClient } from '@kbn/connector-specs';
import { isSelectedActionEnabled, type SelectedActions } from '@kbn/connector-specs-runtime';
import { z, lazySchema } from '@kbn/zod/v4';
import type { ActionRuntimeOptions } from '../lib/execute_action';
import { RelayRequestError } from '../lib/relay/relay_error';
import type { ConnectorRelayRequest, ConnectorRelayResponse } from './types';

const requestSchema = lazySchema(() =>
  z.discriminatedUnion('operation', [
    z.object({
      operation: z.literal('trigger'),
      input: z.object({
        channel: z.string().min(1).max(1024),
        message: z
          .string()
          .min(1)
          .max(1024 * 1024),
        blocks: z
          .array(z.record(z.string().max(256), z.unknown()))
          .max(50)
          .optional(),
        threadTs: z.string().max(64).optional(),
        messageTs: z.string().max(64).optional(),
      }),
    }),
    z.object({
      operation: z.literal('listBindings'),
      options: z
        .object({
          cursor: z
            .string()
            .max(64 * 1024)
            .optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    }),
  ])
);

/** Keeps Kibana's UIAM identity and mTLS private key exclusively in the coordinator transport. */
export class ConnectorRelayTransport {
  private identity?: {
    readonly tenantKey: string;
    readonly subAction: string;
    readonly selectedActions: SelectedActions;
  };

  constructor(
    private readonly client: RelayActionClient,
    options: Pick<ActionRuntimeOptions, 'params' | 'config' | 'secrets'> & {
      readonly actionType: Pick<ActionRuntimeOptions['actionType'], 'id'>;
    },
    private readonly signal: AbortSignal
  ) {
    if (
      options.actionType.id === '.slack2' &&
      options.secrets.authType === 'relay' &&
      typeof options.secrets.tenantKey === 'string' &&
      typeof options.params.subAction === 'string'
    ) {
      this.identity = {
        tenantKey: options.secrets.tenantKey,
        subAction: options.params.subAction,
        selectedActions: options.config.selectedActions as SelectedActions,
      };
    }
  }

  async execute(input: ConnectorRelayRequest): Promise<ConnectorRelayResponse> {
    this.signal.throwIfAborted();
    const identity = this.identity;
    if (!identity) throw new Error('Connector Relay invocation is not available');
    const { tenantKey, subAction, selectedActions } = identity;
    if (
      !['sendMessage', 'updateMessage', 'listChannels', 'resolveChannelId'].includes(subAction) ||
      !isSelectedActionEnabled(subAction, selectedActions)
    ) {
      throw new Error('Connector action is not enabled for Relay transport');
    }
    const request = requestSchema.parse(input);
    if (
      request.operation === 'trigger' &&
      subAction !== 'sendMessage' &&
      subAction !== 'updateMessage'
    ) {
      throw new Error('Connector action cannot post through Relay transport');
    }
    try {
      if (request.operation === 'trigger') {
        return {
          operation: 'trigger',
          result: await this.client.trigger({ ...request.input, tenantKey }),
        };
      }
      return {
        operation: 'listBindings',
        result: await this.client.listBindings(tenantKey, request.options),
      };
    } catch (error) {
      // Axios failures and Relay error bodies can echo the system bearer/certificate; only status crosses RPC.
      return {
        error: { ...(error instanceof RelayRequestError ? { statusCode: error.statusCode } : {}) },
      };
    }
  }

  close(): void {
    this.identity = undefined;
  }
}

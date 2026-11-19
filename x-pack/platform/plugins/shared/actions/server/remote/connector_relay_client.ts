/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RelayActionClient } from '@kbn/connector-specs';
import type { ConnectorRelayResponse, NativeActionsApi } from './types';

type RelayClient = RelayActionClient & {
  trigger(
    input: Parameters<RelayActionClient['trigger']>[0] & { blocks?: Array<Record<string, unknown>> }
  ): ReturnType<RelayActionClient['trigger']>;
};

/** Exposes only action transport; installation, credentials and arbitrary URLs never cross the boundary. */
export const createConnectorRelayClient = (
  actions: NativeActionsApi,
  scopeId: string,
  invocationId: string
): RelayClient => {
  const unwrap = (response: ConnectorRelayResponse) => {
    if ('error' in response) {
      throw Object.assign(new Error('Relay transport request failed'), response.error);
    }
    return response;
  };
  return {
    trigger: async ({ tenantKey, ...input }) => {
      const response = unwrap(
        await actions.relay(scopeId, invocationId, { operation: 'trigger', input })
      );
      if (response.operation !== 'trigger') throw new Error('Relay response operation mismatch');
      return response.result;
    },
    listBindings: async (_tenantKey, options) => {
      const response = unwrap(
        await actions.relay(scopeId, invocationId, { operation: 'listBindings', options })
      );
      if (response.operation !== 'listBindings')
        throw new Error('Relay response operation mismatch');
      return response.result;
    },
  };
};

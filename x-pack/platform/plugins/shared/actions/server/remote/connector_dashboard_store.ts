/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SavedObject, SavedObjectsClientContract } from '@kbn/core/server';
import type { NativeActionsApi, ConnectorDashboardRequest } from './types';

/** Adapts the original dashboard helper to invocation-bound saved-object access. */
export const createConnectorDashboardStore = (
  actions: NativeActionsApi,
  scopeId: string,
  invocationId: string
): Pick<SavedObjectsClientContract, 'get' | 'create'> => {
  const execute = async <T>(request: ConnectorDashboardRequest): Promise<SavedObject<T>> => {
    const response = await actions.dashboard(scopeId, invocationId, request);
    if ('error' in response) {
      const { message, statusCode, error } = response.error;
      throw Object.assign(new Error(message), {
        output: { statusCode, payload: { error, message } },
      });
    }
    return response.value as SavedObject<T>;
  };
  return {
    get: async <T>() => execute<T>({ operation: 'get' }),
    create: async <T>() => execute<T>({ operation: 'create' }),
  };
};

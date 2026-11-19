/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ClientTypeId } from './client_registry';
import type { ClientTypeSpec } from './client_type_spec';

const loaders: Readonly<Record<string, () => Promise<ClientTypeSpec<unknown>>>> = {
  mcp: async () => (await import('./mcp_client_type')).mcpClientType,
  mongodb: async () => (await import('./mongodb_client_type')).mongodbClientType,
  mssql: async () => (await import('./mssql')).mssqlClientType,
  mysql: async () => (await import('./mysql')).mysqlClientType,
} satisfies Record<ClientTypeId, () => Promise<ClientTypeSpec<unknown>>>;

/** Loads only the requested original client factory, without constructing or retaining a client. */
export const getClientType = async (id: string): Promise<ClientTypeSpec<unknown> | undefined> => {
  if (!Object.hasOwn(loaders, id)) return undefined;
  return loaders[id]();
};

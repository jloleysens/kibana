/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getAxiosAuthStrategy } from './axios_auth_strategies';
import { createAxiosTransport, createCredentialAccessor } from './create_axios_transport';
import type {
  AxiosTransportDependencies,
  GetAxiosInstanceWithAuthFn,
  GetCredentialFn,
} from './create_axios_transport';

export { buildUserAgent, UnsupportedAuthProducerError } from './create_axios_transport';
export type {
  ConnectorInfo,
  GetAxiosInstanceWithAuthFnOpts,
  GetAxiosInstanceWithAuthFn,
  GetCredentialFnOpts,
  GetCredentialFn,
} from './create_axios_transport';

type GetAxiosInstanceOpts = Omit<AxiosTransportDependencies, 'getAuthStrategy'>;

export const getAxiosInstanceWithAuth = (
  options: GetAxiosInstanceOpts
): GetAxiosInstanceWithAuthFn =>
  createAxiosTransport({ ...options, getAuthStrategy: getAxiosAuthStrategy });

export const getCredentialWithAuth = (options: GetAxiosInstanceOpts): GetCredentialFn =>
  createCredentialAccessor({ ...options, getAuthStrategy: getAxiosAuthStrategy });

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  ActionTypeExecutorOptions,
  ActionTypeExecutorResult,
  ClassicActionType,
  ConnectorTokenStore,
} from '../types';

export interface EmailExecutionFacts {
  readonly publicBaseUrl?: string;
  readonly isElasticCloudTrial: boolean;
}

export type ClassicExecutorOptions<
  Config extends Record<string, unknown>,
  Secrets extends Record<string, unknown>,
  Params
> = Omit<
  ActionTypeExecutorOptions<Config, Secrets, Params>,
  'services' | 'connectorTokenClient'
> & {
  readonly services: { readonly connectorTokenClient: ConnectorTokenStore };
  readonly connectorTokenClient?: ConnectorTokenStore;
};

export type ClassicConnectorType<
  Config extends Record<string, unknown>,
  Secrets extends Record<string, unknown>,
  Params extends Record<string, unknown>,
  Result = void
> = Omit<ClassicActionType<Config, Secrets, Params, Result>, 'executor'> & {
  readonly executor: (
    options: ClassicExecutorOptions<Config, Secrets, Params>
  ) => Promise<ActionTypeExecutorResult<Result>>;
};

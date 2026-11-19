/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  ClassicConnectorType as ConnectorType,
  ClassicExecutorOptions as ConnectorTypeExecutorOptions,
} from '@kbn/actions-plugin/server/remote/classic_connector_types';
import type { ActionTypeExecutorResult } from '@kbn/actions-plugin/server/types';
import type {
  ConnectorTypeConfigType,
  ConnectorTypeSecretsType,
  ActionParamsType,
} from '@kbn/connector-schemas/http';

export type HttpConnectorType = ConnectorType<
  ConnectorTypeConfigType,
  ConnectorTypeSecretsType,
  ActionParamsType,
  unknown
>;
export type HttpConnectorTypeExecutorOptions = ConnectorTypeExecutorOptions<
  ConnectorTypeConfigType,
  ConnectorTypeSecretsType,
  ActionParamsType
>;

export interface HttpConnectorResponse {
  status: number;
  statusText: string;
  data: unknown;
  headers: Record<string, string>;
}

export type HttpConnectorTypeExecutorResult = ActionTypeExecutorResult<HttpConnectorResponse>;

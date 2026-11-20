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
import type {
  ConnectorTypeConfigType,
  ConnectorTypeSecretsType,
  ActionParamsType,
} from '@kbn/connector-schemas/webhook';

export type WebhookConnectorType = ConnectorType<
  ConnectorTypeConfigType,
  ConnectorTypeSecretsType,
  ActionParamsType,
  unknown
>;

export type WebhookConnectorTypeExecutorOptions = ConnectorTypeExecutorOptions<
  ConnectorTypeConfigType,
  ConnectorTypeSecretsType,
  ActionParamsType
>;

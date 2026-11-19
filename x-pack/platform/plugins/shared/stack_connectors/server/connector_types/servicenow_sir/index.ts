/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getServiceNowSIRConnectorType as getExecutionConnectorType } from './get_connector_type';
export type {
  ServiceNowConnectorType,
  ServiceNowConnectorTypeExecutorOptions,
} from './get_connector_type';

export const getServiceNowSIRConnectorType = (): ReturnType<typeof getExecutionConnectorType> => ({
  ...getExecutionConnectorType(),
});

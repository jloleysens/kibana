/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  SubActionConnectorType,
  SubActionServices,
} from '@kbn/actions-plugin/server/sub_action_framework/types';
import type { Services } from '@kbn/actions-plugin/server/types';
import type { Config, Secrets } from '@kbn/connector-schemas/bedrock';
import { getConnectorType as getExecutionConnectorType } from './get_connector_type';
import { renderParameterTemplates } from './render';

export { configValidator } from './get_connector_type';

export const getConnectorType = <
  ExecutionServices extends SubActionServices = Services
>(): SubActionConnectorType<Config, Secrets, ExecutionServices> => ({
  ...getExecutionConnectorType<ExecutionServices>(),
  renderParameterTemplates,
});

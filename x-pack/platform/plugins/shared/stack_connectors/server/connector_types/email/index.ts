/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getConnectorType as getExecutionConnectorType } from './get_connector_type';
import { renderParameterTemplates } from './render';
export {
  CUSTOM_HOST_PORT_SERVICES,
  ELASTIC_CLOUD_SERVICE,
  ELASTIC_CLOUD_TRIAL_SUBJECT_PREFIX,
} from './get_connector_type';
export type { EmailConnectorType, EmailConnectorTypeExecutorOptions } from './get_connector_type';

export const getConnectorType = (
  params: Parameters<typeof getExecutionConnectorType>[0]
): ReturnType<typeof getExecutionConnectorType> => ({
  ...getExecutionConnectorType(params),
  renderParameterTemplates,
});

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  getConnectorType as getExecutionConnectorType,
  getSystemConnectorType as getSystemExecutionConnectorType,
} from './get_connector_type';
import { renderParameterTemplates } from './render';
export { executor } from './get_connector_type';

export const getConnectorType = (): ReturnType<typeof getExecutionConnectorType> => ({
  ...getExecutionConnectorType(),
  renderParameterTemplates,
});

export const getSystemConnectorType = (): ReturnType<typeof getSystemExecutionConnectorType> => ({
  ...getSystemExecutionConnectorType(),
  renderParameterTemplates,
});

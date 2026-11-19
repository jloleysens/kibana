/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SubActionConnectorType } from '@kbn/actions-plugin/server/sub_action_framework/types';
import type { D3SecurityConfig, D3SecuritySecrets } from '@kbn/connector-schemas/d3security';
import { getConnectorType as getExecutionConnectorType } from './get_connector_type';
import { renderParameterTemplates } from './render';

export const getConnectorType = (): SubActionConnectorType<
  D3SecurityConfig,
  D3SecuritySecrets
> => ({
  ...getExecutionConnectorType(),
  renderParameterTemplates,
});

export type { D3SecurityConnectorType } from './get_connector_type';

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SubActionConnectorType } from '@kbn/actions-plugin/server/sub_action_framework/types';
import type { TheHiveConfig, TheHiveSecrets } from '@kbn/connector-schemas/thehive';
import { getConnectorType as getExecutionConnectorType } from './get_connector_type';
import { renderParameterTemplates } from './render';

export const getConnectorType = (): SubActionConnectorType<TheHiveConfig, TheHiveSecrets> => ({
  ...getExecutionConnectorType(),
  renderParameterTemplates,
});

export type { TheHiveConnectorType } from './get_connector_type';

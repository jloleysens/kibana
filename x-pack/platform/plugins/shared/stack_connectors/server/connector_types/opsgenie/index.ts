/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SubActionConnectorType } from '@kbn/actions-plugin/server/sub_action_framework/types';
import type { Config, Secrets } from '@kbn/connector-schemas/opsgenie';
import { getOpsgenieConnectorType as getExecutionConnectorType } from './get_connector_type';
import { renderParameterTemplates } from './render_template_variables';

export const getOpsgenieConnectorType = (): SubActionConnectorType<Config, Secrets> => ({
  ...getExecutionConnectorType(),
  renderParameterTemplates,
});

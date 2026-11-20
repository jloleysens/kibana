/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { i18n } from '@kbn/i18n';
import type {
  SubActionServices,
  SubActionConnectorType,
} from '@kbn/actions-plugin/server/sub_action_framework/types';
import { ValidatorType } from '@kbn/actions-plugin/server/sub_action_framework/types';
import {
  GenerativeAIForObservabilityConnectorFeatureId,
  GenerativeAIForSecurityConnectorFeatureId,
  WorkflowsConnectorFeatureId,
} from '@kbn/actions-plugin/common';
import type { ValidatorServices } from '@kbn/actions-plugin/server/types';
import {
  assertURL,
  urlAllowListValidator,
} from '@kbn/actions-plugin/server/sub_action_framework/helpers/validators';
import { CONNECTOR_ID, CONNECTOR_NAME } from '@kbn/connector-schemas/bedrock';
import { ConfigSchema, SecretsSchema } from '@kbn/connector-schemas/bedrock';
import type { Config, Secrets } from '@kbn/connector-schemas/bedrock';
import type { Services } from '@kbn/actions-plugin/server/types';
import { BedrockConnector } from './bedrock';

import { getDashboard } from '../lib/gen_ai/gen_ai_dashboard';

export const getConnectorType = <
  ExecutionServices extends SubActionServices = Services
>(): SubActionConnectorType<Config, Secrets, ExecutionServices> => ({
  getDashboardAttributes: (dashboardId) => getDashboard('Bedrock', dashboardId).attributes,
  id: CONNECTOR_ID,
  name: CONNECTOR_NAME,
  getService: (params) => new BedrockConnector(params),
  schema: {
    config: ConfigSchema,
    secrets: SecretsSchema,
  },
  validators: [{ type: ValidatorType.CONFIG, validator: configValidator }],
  supportedFeatureIds: [
    GenerativeAIForSecurityConnectorFeatureId,
    GenerativeAIForObservabilityConnectorFeatureId,
    WorkflowsConnectorFeatureId,
  ],
  minimumLicenseRequired: 'enterprise' as const,
  isDeprecated: true,
});

export const configValidator = (configObject: Config, validatorServices: ValidatorServices) => {
  try {
    assertURL(configObject.apiUrl);
    urlAllowListValidator('apiUrl')(configObject, validatorServices);

    return configObject;
  } catch (err) {
    throw new Error(
      i18n.translate('xpack.stackConnectors.bedrock.configurationErrorApiProvider', {
        defaultMessage: 'Error configuring Amazon Bedrock action: {err}',
        values: {
          err: err.toString(),
        },
      })
    );
  }
};

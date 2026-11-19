/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Services } from '@kbn/actions-plugin/server/types';
import type {
  SubActionConnectorType,
  SubActionServices,
} from '@kbn/actions-plugin/server/sub_action_framework/types';
import { ValidatorType } from '@kbn/actions-plugin/server/sub_action_framework/types';
import {
  AlertingConnectorFeatureId,
  SecurityConnectorFeatureId,
  UptimeConnectorFeatureId,
  CasesConnectorFeatureId,
  WorkflowsConnectorFeatureId,
  AgentBuilderConnectorFeatureId,
} from '@kbn/actions-plugin/common';
import { urlAllowListValidator } from '@kbn/actions-plugin/server/sub_action_framework/helpers/validators';
import {
  CONNECTOR_ID,
  CONNECTOR_NAME,
  PushToServiceIncidentSchema,
  TheHiveConfigSchema,
  TheHiveSecretsSchema,
} from '@kbn/connector-schemas/thehive';
import type { TheHiveConfig, TheHiveSecrets } from '@kbn/connector-schemas/thehive';
import { TheHiveConnector } from './thehive';

export type TheHiveConnectorType<ExecutionServices extends SubActionServices = Services> =
  SubActionConnectorType<TheHiveConfig, TheHiveSecrets, ExecutionServices>;

export function getConnectorType<
  ExecutionServices extends SubActionServices = Services
>(): TheHiveConnectorType<ExecutionServices> {
  return {
    id: CONNECTOR_ID,
    minimumLicenseRequired: 'platinum',
    name: CONNECTOR_NAME,
    getService: (params) => new TheHiveConnector(params, PushToServiceIncidentSchema),
    supportedFeatureIds: [
      AlertingConnectorFeatureId,
      SecurityConnectorFeatureId,
      UptimeConnectorFeatureId,
      CasesConnectorFeatureId,
      WorkflowsConnectorFeatureId,
      AgentBuilderConnectorFeatureId,
    ],
    schema: {
      config: TheHiveConfigSchema,
      secrets: TheHiveSecretsSchema,
    },
    validators: [{ type: ValidatorType.CONFIG, validator: urlAllowListValidator('url') }],
  };
}

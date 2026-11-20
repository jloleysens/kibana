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
  SecurityConnectorFeatureId,
  WorkflowsConnectorFeatureId,
  AgentBuilderConnectorFeatureId,
} from '@kbn/actions-plugin/common';
import { urlAllowListValidator } from '@kbn/actions-plugin/server/sub_action_framework/helpers/validators';
import type { Config, Secrets } from '@kbn/connector-schemas/xsoar';
import {
  CONNECTOR_ID,
  CONNECTOR_NAME,
  ConfigSchema,
  SecretsSchema,
} from '@kbn/connector-schemas/xsoar';
import { XSOARConnector } from './xsoar';

export type XSOARConnectorType<ExecutionServices extends SubActionServices = Services> =
  SubActionConnectorType<Config, Secrets, ExecutionServices>;

export function getConnectorType<
  ExecutionServices extends SubActionServices = Services
>(): XSOARConnectorType<ExecutionServices> {
  return {
    id: CONNECTOR_ID,
    minimumLicenseRequired: 'platinum',
    name: CONNECTOR_NAME,
    getService: (params) => new XSOARConnector(params),
    supportedFeatureIds: [
      SecurityConnectorFeatureId,
      WorkflowsConnectorFeatureId,
      AgentBuilderConnectorFeatureId,
    ],
    schema: {
      config: ConfigSchema,
      secrets: SecretsSchema,
    },
    validators: [{ type: ValidatorType.CONFIG, validator: urlAllowListValidator('url') }],
  };
}

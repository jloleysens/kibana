/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getConnectorType as email } from '../connector_types/email';
import { getConnectorType as http, getSystemConnectorType } from '../connector_types/http';
import { clientTypes } from '@kbn/connector-specs/server';
import { mcpClientType } from '@kbn/connector-specs/server/mcp_client_type';

it('resolves current trial status as data only for the original Elastic Cloud email mode', async () => {
  const isElasticCloudTrial = jest.fn(async () => true);
  const connector = email({ publicBaseUrl: 'https://kibana.invalid', isElasticCloudTrial });
  expect(await connector.getEmailExecutionFacts?.({ service: 'other' })).toEqual({
    publicBaseUrl: 'https://kibana.invalid',
    isElasticCloudTrial: false,
  });
  expect(isElasticCloudTrial).not.toHaveBeenCalled();
  expect(await connector.getEmailExecutionFacts?.({ service: 'elastic_cloud' })).toEqual({
    publicBaseUrl: 'https://kibana.invalid',
    isElasticCloudTrial: true,
  });
  isElasticCloudTrial.mockResolvedValue(false);
  expect(await connector.getEmailExecutionFacts?.({ service: 'elastic_cloud' })).toEqual({
    publicBaseUrl: 'https://kibana.invalid',
    isElasticCloudTrial: false,
  });
  expect(isElasticCloudTrial).toHaveBeenCalledTimes(2);
});

it('retains the exact original renderer for both ordinary HTTP variants', () => {
  expect(http().renderParameterTemplates).toBe(getSystemConnectorType().renderParameterTemplates);
  expect(http().renderParameterTemplates).toBeDefined();
});

it('shares the original MCP client type identity with the historical catalog export', () => {
  expect(mcpClientType).toBe(clientTypes.mcp);
});

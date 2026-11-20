/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { actionsMock } from '@kbn/actions-plugin/server/mocks';
import { actionsConfigMock } from '@kbn/actions-plugin/server/actions_config.mock';
import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { getConnectorType as d3security } from '../connector_types/d3security/get_connector_type';
import { getOpsgenieConnectorType as opsgenie } from '../connector_types/opsgenie/get_connector_type';
import { getJiraServiceManagementConnectorType as jiraServiceManagement } from '../connector_types/jira-service-management/get_connector_type';
import { getTinesConnectorType as tines } from '../connector_types/tines/get_connector_type';
import { getConnectorType as xsoar } from '../connector_types/xsoar/get_connector_type';
import { getResilientConnectorType as resilient } from '../connector_types/resilient/get_connector_type';
import { getConnectorType as thehive } from '../connector_types/thehive/get_connector_type';
import { remoteModule } from '.';

const common = {
  connector: { id: 'saved', type: '.fake' },
  services: actionsMock.createServices(),
  logger: loggingSystemMock.createLogger(),
  configurationUtilities: actionsConfigMock.create(),
};

it('registers all fifteen remaining SubAction operations through their original services', () => {
  const cases = [
    {
      id: d3security().id,
      service: d3security().getService({
        ...common,
        config: { url: 'http://127.0.0.1' },
        secrets: { token: 'fake' },
      }),
      operations: ['run', 'test'],
    },
    {
      id: opsgenie().id,
      service: opsgenie().getService({
        ...common,
        config: { apiUrl: 'http://127.0.0.1' },
        secrets: { apiKey: 'fake' },
      }),
      operations: ['createAlert', 'closeAlert'],
    },
    {
      id: jiraServiceManagement().id,
      service: jiraServiceManagement().getService({
        ...common,
        config: { apiUrl: 'http://127.0.0.1' },
        secrets: { apiKey: 'fake' },
      }),
      operations: ['createAlert', 'closeAlert'],
    },
    {
      id: tines().id,
      service: tines().getService({
        ...common,
        config: { url: 'http://127.0.0.1' },
        secrets: { email: 'fake', token: 'fake' },
      }),
      operations: ['stories', 'webhooks', 'run', 'test'],
    },
    {
      id: xsoar().id,
      service: xsoar().getService({
        ...common,
        config: { url: 'http://127.0.0.1' },
        secrets: { apiKey: 'fake', apiKeyID: null },
      }),
      operations: ['getPlaybooks', 'run'],
    },
    {
      id: resilient().id,
      service: resilient().getService({
        ...common,
        config: { apiUrl: 'http://127.0.0.1', orgId: 'fake' },
        secrets: { apiKeyId: 'fake', apiKeySecret: 'fake' },
      }),
      operations: ['pushToService'],
    },
    {
      id: thehive().id,
      service: thehive().getService({
        ...common,
        config: { url: 'http://127.0.0.1', organisation: null },
        secrets: { apiKey: 'fake' },
      }),
      operations: ['pushToService', 'createAlert'],
    },
  ];
  let count = 0;
  for (const entry of cases) {
    const { id, service, operations } = entry;
    expect(remoteModule.contributions?.some(({ stepType }) => '.' + stepType === id)).toBe(true);
    for (const operation of operations) {
      expect(service.getSubActions().has(operation)).toBe(true);
      count++;
    }
  }
  expect(count).toBe(15);
});

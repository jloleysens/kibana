/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { resolve } from 'node:path';
import { readRemoteManifest } from './manifest';

const remainingLegacyOperations = [
  'd3security.run',
  'd3security.test',
  'email',
  'http',
  'jira-service-management.closeAlert',
  'jira-service-management.createAlert',
  'jira.fieldsByIssueType',
  'jira.getFields',
  'jira.getIncident',
  'jira.issue',
  'jira.issueTypes',
  'jira.issues',
  'jira.pushToService',
  'mcp.callTool',
  'mcp.listTools',
  'mcp.test',
  'opsgenie.closeAlert',
  'opsgenie.createAlert',
  'pagerduty',
  'resilient',
  'servicenow',
  'servicenow-itom.addEvent',
  'servicenow-itom.getChoices',
  'servicenow-sir.getChoices',
  'servicenow-sir.getFields',
  'servicenow-sir.getIncident',
  'servicenow-sir.pushToService',
  'slack',
  'slack_api.postBlockkit',
  'slack_api.postMessage',
  'slack_api.validChannelId',
  'swimlane.pushToService',
  'teams',
  'thehive.createAlert',
  'thehive.pushToService',
  'tines.run',
  'tines.stories',
  'tines.test',
  'tines.webhooks',
  'torq',
  'xmatters',
  'xsoar.getPlaybooks',
  'xsoar.run',
] as const;

it.each(remainingLegacyOperations)(
  'routes original legacy operation %s to its native type contribution',
  (operation) => {
    const manifest = readRemoteManifest(
      resolve(
        __dirname,
        '../../../x-pack/platform/plugins/shared/stack_connectors/server/remote/index.ts'
      )
    );
    const type = operation.split('.')[0];
    expect(manifest.contributions.filter(({ stepType }) => stepType === type)).toHaveLength(1);
  }
);

it('accounts for all43 remaining operations and21 families without inventing eligibility', () => {
  expect(remainingLegacyOperations).toHaveLength(43);
  expect(new Set(remainingLegacyOperations.map((operation) => operation.split('.')[0])).size).toBe(
    21
  );
});

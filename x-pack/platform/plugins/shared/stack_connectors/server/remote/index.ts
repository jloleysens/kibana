/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RemoteModule } from '@kbn/core-remote-common';
import { WorkflowConnectorKind } from '@kbn/actions-plugin/server/remote/tokens';

export const remoteModule: RemoteModule = {
  contributions: [
    {
      kind: WorkflowConnectorKind,
      stepType: 'mcp',
      modulePath: require.resolve('./mcp'),
      exportName: 'McpConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'http',
      modulePath: require.resolve('./http'),
      exportName: 'HttpConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'email',
      modulePath: require.resolve('./email'),
      exportName: 'EmailConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'slack',
      modulePath: require.resolve('./slack'),
      exportName: 'SlackConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'slack_api',
      modulePath: require.resolve('./slack_api'),
      exportName: 'SlackApiConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'teams',
      modulePath: require.resolve('./teams'),
      exportName: 'TeamsConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'pagerduty',
      modulePath: require.resolve('./pagerduty'),
      exportName: 'PagerDutyConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'torq',
      modulePath: require.resolve('./torq'),
      exportName: 'TorqConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'xmatters',
      modulePath: require.resolve('./xmatters'),
      exportName: 'XmattersConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'jira',
      modulePath: require.resolve('./jira'),
      exportName: 'JiraConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'servicenow',
      modulePath: require.resolve('./servicenow'),
      exportName: 'ServiceNowITSMConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'servicenow-itom',
      modulePath: require.resolve('./servicenow_itom'),
      exportName: 'ServiceNowITOMConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'servicenow-sir',
      modulePath: require.resolve('./servicenow_sir'),
      exportName: 'ServiceNowSIRConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'swimlane',
      modulePath: require.resolve('./swimlane'),
      exportName: 'SwimlaneConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'd3security',
      modulePath: require.resolve('./d3security'),
      exportName: 'D3SecurityConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'opsgenie',
      modulePath: require.resolve('./opsgenie'),
      exportName: 'OpsgenieConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'tines',
      modulePath: require.resolve('./tines'),
      exportName: 'TinesConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'resilient',
      modulePath: require.resolve('./resilient'),
      exportName: 'ResilientConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'thehive',
      modulePath: require.resolve('./thehive'),
      exportName: 'TheHiveConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'xsoar',
      modulePath: require.resolve('./xsoar'),
      exportName: 'XSOARConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'jira-service-management',
      modulePath: require.resolve('./jira_service_management'),
      exportName: 'JiraServiceManagementConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'inference',
      modulePath: require.resolve('./inference'),
      exportName: 'InferenceConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'gen-ai',
      modulePath: require.resolve('./openai'),
      exportName: 'OpenAIConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'bedrock',
      modulePath: require.resolve('./bedrock'),
      exportName: 'BedrockConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'gemini',
      modulePath: require.resolve('./gemini'),
      exportName: 'GeminiConnector',
    },
  ],
};

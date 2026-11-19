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

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RemoteModule } from '@kbn/core-remote-common';
import { SpecRuntimeToken, WorkflowConnectorKind } from './tokens';
export const remoteModule: RemoteModule = {
  contributions: [
    {
      kind: WorkflowConnectorKind,
      stepType: 'rootly',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/rootly'),
      exportName: 'RootlyConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'unifi',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/unifi'),
      exportName: 'UnifiConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'buildkite',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/buildkite'),
      exportName: 'BuildkiteConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'dynatrace',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/dynatrace'),
      exportName: 'DynatraceConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'grafana',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/grafana'),
      exportName: 'GrafanaConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'new_relic',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/new_relic'),
      exportName: 'NewRelicConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'prometheus',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/prometheus'),
      exportName: 'PrometheusConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'sentry',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/sentry'),
      exportName: 'SentryConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'datadog',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/datadog'),
      exportName: 'DatadogConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'censys',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/censys'),
      exportName: 'CensysConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'pagerduty_mcp',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/pagerduty_mcp'),
      exportName: 'PagerdutyConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'jenkins',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/jenkins'),
      exportName: 'JenkinsConnector',
    },
  ],
  providers: [
    {
      token: SpecRuntimeToken,
      placement: 'executor',
      modulePath: require.resolve('./spec_runtime'),
      exportName: 'SpecRuntime',
    },
  ],
};

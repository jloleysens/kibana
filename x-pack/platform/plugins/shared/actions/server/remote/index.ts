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
      stepType: 'google_threat_intelligence',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/google_threat_intelligence'),
      exportName: 'GoogleThreatIntelligenceConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'ansible_controller',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/ansible_controller'),
      exportName: 'AnsibleControllerConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'misp',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/misp'),
      exportName: 'MispConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'sublime_security',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/sublime_security'),
      exportName: 'SublimeSecurityConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'urlscan_io',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/urlscan_io'),
      exportName: 'UrlscanIoConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'firecrawl',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/firecrawl'),
      exportName: 'FirecrawlConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'solarwinds_platform',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/solarwinds_platform'),
      exportName: 'SolarwindsPlatformConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'abuseipdb',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/abuseipdb'),
      exportName: 'AbuseipdbConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'virustotal',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/virustotal'),
      exportName: 'VirustotalConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'zendesk',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/zendesk'),
      exportName: 'ZendeskConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'alienvault-otx',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/alienvault_otx'),
      exportName: 'AlienvaultOtxConnector',
    },
    {
      kind: WorkflowConnectorKind,
      stepType: 'confluence-cloud',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/confluence'),
      exportName: 'ConfluenceConnector',
    },
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

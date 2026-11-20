/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { isConnectorAuthorizationError } from '../../src/errors/connector_authorization_error';
import type { SpecRuntimeApi } from './tokens';
import { RootlyConnector } from './rootly';
import { Rootly as RootlySpec } from '../../src/specs/rootly/rootly';
import { UnifiConnector } from './unifi';
import { Unifi as UnifiSpec } from '../../src/specs/unifi/unifi';
import { BuildkiteConnector } from './buildkite';
import { Buildkite as BuildkiteSpec } from '../../src/specs/buildkite/buildkite';
import { DynatraceConnector } from './dynatrace';
import { Dynatrace as DynatraceSpec } from '../../src/specs/dynatrace/dynatrace';
import { GrafanaConnector } from './grafana';
import { Grafana as GrafanaSpec } from '../../src/specs/grafana/grafana';
import { NewRelicConnector } from './new_relic';
import { NewRelic as NewRelicSpec } from '../../src/specs/new_relic/new_relic';
import { PrometheusConnector } from './prometheus';
import { Prometheus as PrometheusSpec } from '../../src/specs/prometheus/prometheus';
import { SentryConnector } from './sentry';
import { Sentry as SentrySpec } from '../../src/specs/sentry/sentry';
import { DatadogConnector } from './datadog';
import { Datadog as DatadogSpec } from '../../src/specs/datadog/datadog';
import { CensysConnector } from './censys';
import { CensysConnector as CensysConnectorSpec } from '../../src/specs/censys/censys';
import { PagerdutyConnector } from './pagerduty_mcp';
import { PagerdutyConnector as PagerdutyConnectorSpec } from '../../src/specs/pagerduty/pagerduty';

describe.each([
  {
    id: 'rootly',
    Connector: RootlyConnector,
    spec: RootlySpec,
    operations: [
      'acknowledgeAlert',
      'addIncidentSubscribers',
      'assignIncidentUser',
      'cancelIncident',
      'createActionItem',
      'createIncident',
      'createTimelineEvent',
      'getAlert',
      'getIncident',
      'listActionItems',
      'listAlerts',
      'listIncidents',
      'listServices',
      'listSeverities',
      'listTeams',
      'mitigateIncident',
      'resolveAlert',
      'resolveIncident',
      'triageIncident',
      'updateIncident',
    ],
  },
  {
    id: 'unifi',
    Connector: UnifiConnector,
    spec: UnifiSpec,
    operations: [
      'authorizeGuestAccess',
      'getCameraSnapshot',
      'getClient',
      'getDevice',
      'getDeviceStatistics',
      'getNetworkInfo',
      'getNvr',
      'getProtectDevice',
      'getProtectInfo',
      'listClients',
      'listDevices',
      'listFirewallPolicies',
      'listNetworks',
      'listProtectDevices',
      'listSites',
      'listWans',
      'movePtzCameraToPreset',
      'powerCyclePort',
      'restartDevice',
      'unauthorizeGuestAccess',
    ],
  },
  {
    id: 'buildkite',
    Connector: BuildkiteConnector,
    spec: BuildkiteSpec,
    operations: [
      'callTool',
      'cancelBuild',
      'createBuild',
      'createBuildAnnotation',
      'getBuild',
      'getJobLog',
      'getPipeline',
      'listArtifacts',
      'listBuildAnnotations',
      'listBuilds',
      'listJobs',
      'listPipelines',
      'listTools',
      'rebuild',
      'retryFailedJobs',
      'retryJob',
      'unblockJob',
    ],
  },
  {
    id: 'dynatrace',
    Connector: DynatraceConnector,
    spec: DynatraceSpec,
    operations: [
      'addProblemComment',
      'closeProblem',
      'createMaintenanceWindow',
      'deleteMaintenanceWindow',
      'getEntity',
      'getEvent',
      'getMetricDescriptor',
      'getProblem',
      'ingestEvent',
      'listEntities',
      'listEvents',
      'listMaintenanceWindows',
      'listMetrics',
      'listProblemComments',
      'listProblems',
      'queryMetrics',
    ],
  },
  {
    id: 'grafana',
    Connector: GrafanaConnector,
    spec: GrafanaSpec,
    operations: [
      'createAnnotation',
      'createSilence',
      'deleteAnnotation',
      'deleteSilence',
      'getAlertRule',
      'getAlerts',
      'getDashboard',
      'getNotificationPolicyTree',
      'getSilence',
      'listAnnotations',
      'listContactPoints',
      'listMuteTimings',
      'listRules',
      'listSilences',
      'searchDashboards',
      'updateAnnotation',
    ],
  },
  {
    id: 'new_relic',
    Connector: NewRelicConnector,
    spec: NewRelicSpec,
    operations: [
      'acknowledgeIssue',
      'createAlertPolicy',
      'createDeploymentMarker',
      'createMutingRule',
      'createNrqlCondition',
      'deleteMutingRule',
      'listAlertPolicies',
      'listIncidents',
      'listIssues',
      'listMutingRules',
      'listNrqlConditions',
      'resolveIssue',
      'runNrqlQuery',
      'unacknowledgeIssue',
      'updateMutingRule',
    ],
  },
  {
    id: 'prometheus',
    Connector: PrometheusConnector,
    spec: PrometheusSpec,
    operations: [
      'createAlerts',
      'createSilence',
      'expireSilence',
      'getPrometheusSeries',
      'getSilence',
      'getStatus',
      'listAlertGroups',
      'listAlerts',
      'listPrometheusAlerts',
      'listPrometheusLabelValues',
      'listPrometheusRules',
      'listPrometheusTargets',
      'listSilences',
      'queryPrometheus',
      'queryRangePrometheus',
    ],
  },
  {
    id: 'sentry',
    Connector: SentryConnector,
    spec: SentrySpec,
    operations: [
      'assignIssue',
      'bulkUpdateIssues',
      'createIssueAlertRule',
      'deleteIssue',
      'getEvent',
      'getIssue',
      'ignoreIssue',
      'listIssueAlertRules',
      'listIssueEvents',
      'listIssues',
      'listProjects',
      'resolveIssue',
      'unresolveIssue',
      'updateIssueAlertRule',
    ],
  },
  {
    id: 'datadog',
    Connector: DatadogConnector,
    spec: DatadogSpec,
    operations: [
      'cancelDowntime',
      'createIncident',
      'getAlertEvents',
      'getMonitor',
      'listMonitors',
      'muteMonitor',
      'postEvent',
      'queryTimeseries',
      'scheduleDowntime',
      'searchLogs',
      'unmuteMonitor',
      'updateIncident',
    ],
  },
  {
    id: 'censys',
    Connector: CensysConnector,
    spec: CensysConnectorSpec,
    operations: [
      'censEyeCreateAnalysisJob',
      'censEyeJobResult',
      'censEyeJobStatus',
      'getCertificate',
      'getHost',
      'getHostEnrichment',
      'getHostHistory',
      'getWebProperty',
      'rescan',
      'scanStatus',
    ],
  },
  {
    id: 'pagerduty_mcp',
    Connector: PagerdutyConnector,
    spec: PagerdutyConnectorSpec,
    operations: [
      'acknowledgeIncident',
      'addResponders',
      'browseActivity',
      'browseAlertGrouping',
      'browseChangeEvents',
      'browseEscalationPolicies',
      'browseEventOrchestrations',
      'browseIncidents',
      'browseSchedules',
      'browseServices',
      'browseStatusPages',
      'browseTeams',
      'browseUsers',
      'callTool',
      'listServices',
      'listTools',
      'manageAlertGrouping',
      'manageEventOrchestrations',
      'manageIncidents',
      'manageSchedules',
      'manageServices',
      'manageStatusPages',
      'manageTeams',
      'resolveIncident',
      'runResponsePlay',
      'triggerIncident',
      'updateIncident',
    ],
  },
])('$id connector routing', ({ id, Connector, spec, operations }) => {
  it('preserves every original operation and its auth implementations', () => {
    expect(Object.keys(spec.actions).sort()).toEqual(operations);
  });

  it.each(operations)('routes %s through the original spec runtime', async (operation) => {
    const result = { status: 'ok' };
    const run = jest.fn<ReturnType<SpecRuntimeApi['run']>, Parameters<SpecRuntimeApi['run']>>(
      async () => result
    );
    const runtime: SpecRuntimeApi = { run, drain: jest.fn(), close: jest.fn() };
    const connector = new Connector(runtime);
    const signal = new AbortController().signal;
    const input = {
      connectorType: id,
      connectorNameOrId: 'referenced-connector',
      system: false,
      input: { subAction: operation, subActionParams: {} },
    };
    await expect(connector.run('scope', input, { signal })).resolves.toBe(result);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: spec.metadata }),
      {
        authTypes: expect.any(Array),
        isConnectorAuthorizationError,
      },
      'scope',
      input,
      signal
    );
    const [routedSpec, services] = run.mock.calls[0];
    expect(Object.keys(routedSpec.actions).sort()).toEqual(operations);
    expect(services.authTypes.map(({ id: authTypeId }) => authTypeId).sort()).toEqual(
      spec.auth?.types.map((type) => (typeof type === 'string' ? type : type.type)).sort()
    );
  });
});

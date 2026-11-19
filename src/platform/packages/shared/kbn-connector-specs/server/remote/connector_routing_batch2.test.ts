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
import { GoogleThreatIntelligenceConnector } from './google_threat_intelligence';
import { GoogleThreatIntelligenceConnector as GoogleThreatIntelligenceConnectorSpec } from '../../src/specs/google_threat_intelligence/google_threat_intelligence';
import { AnsibleControllerConnector } from './ansible_controller';
import { AnsibleControllerConnector as AnsibleControllerConnectorSpec } from '../../src/specs/ansible_controller/ansible_controller';
import { MispConnector } from './misp';
import { Misp as MispSpec } from '../../src/specs/misp/misp';
import { SublimeSecurityConnector } from './sublime_security';
import { SublimeSecurityConnector as SublimeSecurityConnectorSpec } from '../../src/specs/sublime_security/sublime_security';
import { UrlscanIoConnector } from './urlscan_io';
import { UrlscanIo as UrlscanIoSpec } from '../../src/specs/urlscan_io/urlscan_io';
import { FirecrawlConnector } from './firecrawl';
import { FirecrawlConnector as FirecrawlConnectorSpec } from '../../src/specs/firecrawl/firecrawl';
import { SolarwindsPlatformConnector } from './solarwinds_platform';
import { SolarWindsPlatform as SolarWindsPlatformSpec } from '../../src/specs/solarwinds_platform/solarwinds_platform';
import { AbuseipdbConnector } from './abuseipdb';
import { AbuseIPDBConnector as AbuseIPDBConnectorSpec } from '../../src/specs/abuseipdb/abuseipdb';
import { VirustotalConnector } from './virustotal';
import { VirusTotalConnector as VirusTotalConnectorSpec } from '../../src/specs/virustotal/virustotal';
import { ZendeskConnector } from './zendesk';
import { ZendeskConnector as ZendeskConnectorSpec } from '../../src/specs/zendesk/zendesk';
import { AlienvaultOtxConnector } from './alienvault_otx';
import { AlienVaultOTXConnector as AlienVaultOTXConnectorSpec } from '../../src/specs/alienvault_otx/alienvault_otx';
import { ConfluenceConnector } from './confluence';
import { ConfluenceCloudConnector as ConfluenceCloudConnectorSpec } from '../../src/specs/atlassian/confluence_cloud/confluence';

describe.each([
  {
    id: 'google_threat_intelligence',
    Connector: GoogleThreatIntelligenceConnector,
    spec: GoogleThreatIntelligenceConnectorSpec,
    operations: [
      'advancedSearch',
      'getAnalysis',
      'getCollection',
      'getDomainRelationship',
      'getDomainReport',
      'getFileBehaviours',
      'getFileMitreAttackTechniques',
      'getFileRelationship',
      'getFileReport',
      'getIocStream',
      'getIpRelationship',
      'getIpReport',
      'getPrivateAnalysis',
      'getPrivateUrlReport',
      'getRelatedObjects',
      'getReportMitreAttackTechniques',
      'getUrlRelationship',
      'getUrlReport',
      'getUrlScanReport',
      'scanPrivateUrl',
      'scanUrl',
      'searchCollectionIocs',
      'searchCollections',
    ],
  },
  {
    id: 'ansible_controller',
    Connector: AnsibleControllerConnector,
    spec: AnsibleControllerConnectorSpec,
    operations: [
      'cancelJob',
      'getJob',
      'getJobStdout',
      'getJobTemplate',
      'getJobTemplateLaunchOptions',
      'getMe',
      'launchJobTemplate',
      'listHosts',
      'listInventories',
      'listJobEvents',
      'listJobTemplates',
      'listJobs',
      'listProjects',
      'request',
    ],
  },
  {
    id: 'misp',
    Connector: MispConnector,
    spec: MispSpec,
    operations: [
      'addAttribute',
      'addSighting',
      'addTagToEvent',
      'checkIndicator',
      'checkWarninglist',
      'createEvent',
      'getEvent',
      'publishEvent',
      'searchAttributes',
      'searchEvents',
    ],
  },
  {
    id: 'sublime_security',
    Connector: SublimeSecurityConnector,
    spec: SublimeSecurityConnectorSpec,
    operations: [
      'getAsaVerdict',
      'getAttackScore',
      'getMessage',
      'getMessageGroup',
      'getTask',
      'listMailboxes',
      'quarantineMessageGroups',
      'restoreMessageGroups',
      'searchMessageGroups',
      'trashMessageGroups',
    ],
  },
  {
    id: 'urlscan_io',
    Connector: UrlscanIoConnector,
    spec: UrlscanIoSpec,
    operations: [
      'getDom',
      'getQuota',
      'getResult',
      'getScreenshot',
      'scanUrl',
      'scanUrlAndWait',
      'searchScans',
    ],
  },
  {
    id: 'firecrawl',
    Connector: FirecrawlConnector,
    spec: FirecrawlConnectorSpec,
    operations: ['crawl', 'crawlAndWait', 'getCrawlStatus', 'map', 'scrape', 'search'],
  },
  {
    id: 'solarwinds_platform',
    Connector: SolarwindsPlatformConnector,
    spec: SolarWindsPlatformSpec,
    operations: [
      'acknowledgeAlert',
      'getAlert',
      'getNode',
      'listActiveAlerts',
      'query',
      'searchNodes',
    ],
  },
  {
    id: 'abuseipdb',
    Connector: AbuseipdbConnector,
    spec: AbuseIPDBConnectorSpec,
    operations: ['bulkCheck', 'checkIp', 'getBlacklist', 'getIpInfo', 'reportIp'],
  },
  {
    id: 'virustotal',
    Connector: VirustotalConnector,
    spec: VirusTotalConnectorSpec,
    operations: ['getAnalysisResults', 'getIpReport', 'scanFileHash', 'scanUrl', 'submitFile'],
  },
  {
    id: 'zendesk',
    Connector: ZendeskConnector,
    spec: ZendeskConnectorSpec,
    operations: ['getTicket', 'getTicketComments', 'listTickets', 'search', 'whoAmI'],
  },
  {
    id: 'alienvault-otx',
    Connector: AlienvaultOtxConnector,
    spec: AlienVaultOTXConnectorSpec,
    operations: ['getIndicator', 'getPulse', 'getRelatedPulses', 'searchPulses'],
  },
  {
    id: 'confluence-cloud',
    Connector: ConfluenceConnector,
    spec: ConfluenceCloudConnectorSpec,
    operations: ['getPage', 'getSpace', 'listPages', 'listSpaces'],
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

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
import { GithubConnector } from './github';
import { GithubConnector as GithubConnectorSpec } from '../../src/specs/github/github';
import { ServicenowSearchConnector } from './servicenow_search';
import { ServicenowSearch as ServicenowSearchSpec } from '../../src/specs/servicenow_search/servicenow_search';
import { BoxConnector } from './box';
import { Box as BoxSpec } from '../../src/specs/box/box';
import { JiraConnector } from './jira';
import { JiraConnector as JiraConnectorSpec } from '../../src/specs/atlassian/jira-cloud/jira';
import { MondayComConnector } from './monday_com';
import { MondayCom as MondayComSpec } from '../../src/specs/monday_com/monday_com';
import { SnowflakeConnector } from './snowflake';
import { Snowflake as SnowflakeSpec } from '../../src/specs/snowflake/snowflake';
import { DropboxConnector } from './dropbox';
import { Dropbox as DropboxSpec } from '../../src/specs/dropbox/dropbox';
import { ZoomConnector } from './zoom';
import { Zoom as ZoomSpec } from '../../src/specs/zoom/zoom';
import { OneDriveConnector } from './one_drive';
import { OneDrive as OneDriveSpec } from '../../src/specs/one_drive/one_drive';
import { HubspotConnector } from './hubspot';
import { HubSpotConnector as HubSpotConnectorSpec } from '../../src/specs/hubspot/hubspot';
import { OutlookConnector } from './outlook';
import { Outlook as OutlookSpec } from '../../src/specs/outlook/outlook';
import { SalesforceConnector } from './salesforce';
import { SalesforceConnector as SalesforceConnectorSpec } from '../../src/specs/salesforce/salesforce';
import { FigmaConnector } from './figma';
import { FigmaConnector as FigmaConnectorSpec } from '../../src/specs/figma/figma';
import { GoogleCloudStorageConnector } from './google_cloud_storage';
import { GoogleCloudStorageConnector as GoogleCloudStorageConnectorSpec } from '../../src/specs/google_cloud_storage/google_cloud_storage';
import { NotionConnector } from './notion';
import { NotionConnector as NotionConnectorSpec } from '../../src/specs/notion/notion';

describe.each([
  {
    id: 'github',
    Connector: GithubConnector,
    spec: GithubConnectorSpec,
    operations: [
      'addAssignee',
      'addIssueComment',
      'addLabels',
      'callTool',
      'createBranch',
      'createIssue',
      'createOrUpdateFile',
      'createPullRequest',
      'getCommit',
      'getFileContents',
      'getIssue',
      'getIssueComments',
      'getLatestRelease',
      'getMe',
      'listBranches',
      'listCommits',
      'listIssues',
      'listPullRequests',
      'listReleases',
      'listTags',
      'listTools',
      'mergePullRequest',
      'pullRequestRead',
      'requestReviewers',
      'searchCode',
      'searchIssues',
      'searchPullRequests',
      'searchRepositories',
      'searchUsers',
      'triggerWorkflow',
      'updateIssue',
      'updatePullRequest',
    ],
  },
  {
    id: 'servicenow_search',
    Connector: ServicenowSearchConnector,
    spec: ServicenowSearchSpec,
    operations: [
      'addComment',
      'addWorkNote',
      'closeIncident',
      'createEvent',
      'createIncident',
      'createRecord',
      'createSecurityIncident',
      'deleteRecord',
      'describeTable',
      'getAttachment',
      'getChoices',
      'getComments',
      'getRecord',
      'listKnowledgeBases',
      'listRecords',
      'listTables',
      'queryUsers',
      'search',
      'updateIncident',
      'updateRecord',
      'uploadAttachment',
      'whoAmI',
    ],
  },
  {
    id: 'box',
    Connector: BoxConnector,
    spec: BoxSpec,
    operations: [
      'aiExtractFreeform',
      'aiExtractStructuredFromMetadataTemplate',
      'aiQaHub',
      'aiQaMultiFile',
      'aiQaSingleFile',
      'callTool',
      'getComments',
      'getFileContent',
      'getFileDetails',
      'getFolderDetails',
      'getHubDetails',
      'getHubItems',
      'listFolderContent',
      'listHubs',
      'listRecentItems',
      'listTools',
      'searchByMetadata',
      'searchFilesKeyword',
      'searchFoldersByName',
      'whoAmI',
    ],
  },
  {
    id: 'jira-cloud',
    Connector: JiraConnector,
    spec: JiraConnectorSpec,
    operations: [
      'addAttachment',
      'addComment',
      'addWatcher',
      'assignIssue',
      'createIssue',
      'deleteIssue',
      'getAttachment',
      'getCreateMetadata',
      'getIssue',
      'getIssueTypes',
      'getProject',
      'getProjects',
      'getTransitions',
      'linkIssues',
      'removeWatcher',
      'searchIssuesWithJql',
      'searchUsers',
      'transitionIssue',
      'updateIssue',
    ],
  },
  {
    id: 'monday_com',
    Connector: MondayComConnector,
    spec: MondayComSpec,
    operations: [
      'archiveItem',
      'callTool',
      'changeItemColumnValues',
      'createItem',
      'createNotification',
      'createSubitem',
      'createUpdate',
      'deleteItem',
      'editUpdate',
      'getBoardInfo',
      'getBoardItemsPage',
      'getItem',
      'getItemsByColumnValue',
      'getUpdates',
      'listTools',
      'moveItemToGroup',
      'search',
      'whoAmI',
    ],
  },
  {
    id: 'snowflake',
    Connector: SnowflakeConnector,
    spec: SnowflakeSpec,
    operations: [
      'cancelStatement',
      'cortexSearch',
      'describeTable',
      'describeView',
      'executeStatement',
      'getStatementStatus',
      'listCortexSearchServices',
      'listDatabases',
      'listSchemas',
      'listTables',
      'listViews',
      'runQuery',
    ],
  },
  {
    id: 'dropbox',
    Connector: DropboxConnector,
    spec: DropboxSpec,
    operations: [
      'callTool',
      'createSharedLink',
      'getFileContent',
      'getFileMetadata',
      'listFolder',
      'listSharedLinks',
      'listTools',
      'search',
      'whoAmI',
    ],
  },
  {
    id: 'zoom',
    Connector: ZoomConnector,
    spec: ZoomSpec,
    operations: [
      'downloadRecordingFile',
      'getMeetingDetails',
      'getMeetingParticipants',
      'getMeetingRecordings',
      'getMeetingRegistrants',
      'getPastMeetingDetails',
      'listMeetings',
      'listUserRecordings',
      'whoAmI',
    ],
  },
  {
    id: 'one_drive',
    Connector: OneDriveConnector,
    spec: OneDriveSpec,
    operations: [
      'getDrive',
      'getFileContent',
      'getFileMetadata',
      'getItemChildren',
      'getMe',
      'listRecentFiles',
      'listSharedWithMe',
      'search',
    ],
  },
  {
    id: 'hubspot',
    Connector: HubspotConnector,
    spec: HubSpotConnectorSpec,
    operations: [
      'getCrmObject',
      'listOwners',
      'listPipelines',
      'searchBroad',
      'searchCrmObjects',
      'searchDeals',
    ],
  },
  {
    id: 'outlook',
    Connector: OutlookConnector,
    spec: OutlookSpec,
    operations: [
      'getAttachment',
      'getMessage',
      'listAttachments',
      'listFolders',
      'listMessages',
      'searchMessages',
    ],
  },
  {
    id: 'salesforce',
    Connector: SalesforceConnector,
    spec: SalesforceConnectorSpec,
    operations: ['describe', 'download_file', 'get_record', 'list_records', 'query', 'search'],
  },
  {
    id: 'figma',
    Connector: FigmaConnector,
    spec: FigmaConnectorSpec,
    operations: ['getFile', 'listProjectFiles', 'listTeamProjects', 'renderNodes', 'whoAmI'],
  },
  {
    id: 'google_cloud_storage',
    Connector: GoogleCloudStorageConnector,
    spec: GoogleCloudStorageConnectorSpec,
    operations: [
      'downloadObject',
      'getObjectMetadata',
      'listBuckets',
      'listObjects',
      'listProjects',
    ],
  },
  {
    id: 'notion',
    Connector: NotionConnector,
    spec: NotionConnectorSpec,
    operations: ['getDataSource', 'getPage', 'queryDataSource', 'searchPageOrDSByTitle'],
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

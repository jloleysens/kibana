/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { SpecRuntimeApi } from './tokens';
import { InboundWebhook } from '../../src/specs/inbound_webhook/inbound_webhook';
import { SlackConnector } from './slack2';
import { Slack as SlackConnectorSpec } from '../../src/specs/slack/slack';
import { GmailConnector } from './gmail';
import { GmailConnector as GmailConnectorSpec } from '../../src/specs/gmail/gmail';
import { SharepointOnlineConnector } from './sharepoint_online';
import { SharepointOnline as SharepointOnlineConnectorSpec } from '../../src/specs/sharepoint_online/sharepoint_online';
import { MicrosoftTeamsConnector } from './microsoft_teams';
import { MicrosoftTeams as MicrosoftTeamsConnectorSpec } from '../../src/specs/microsoft_teams/microsoft_teams';
import { GoogleCalendarConnector } from './google_calendar';
import { GoogleCalendar as GoogleCalendarConnectorSpec } from '../../src/specs/google_calendar/google_calendar';
import { GoogleDriveConnector } from './google_drive';
import { GoogleDriveConnector as GoogleDriveConnectorSpec } from '../../src/specs/google_drive/google_drive';

describe.each([
  {
    id: 'slack2',
    Connector: SlackConnector,
    spec: SlackConnectorSpec,
    operations: [
      'createConversation',
      'getConversationHistory',
      'getConversationInfo',
      'getFileInfo',
      'inviteToConversation',
      'listChannels',
      'listFiles',
      'listUserConversations',
      'listUsers',
      'lookupUserByEmail',
      'resolveChannelId',
      'searchMessages',
      'sendMessage',
      'updateMessage',
      'whoAmI',
    ],
  },
  {
    id: 'gmail',
    Connector: GmailConnector,
    spec: GmailConnectorSpec,
    operations: [
      'getAttachment',
      'getMessage',
      'listLabels',
      'listMessages',
      'markAsRead',
      'markAsUnread',
      'modifyLabels',
      'replyMessage',
      'searchMessages',
      'sendMessage',
      'trashMessage',
      'untrashMessage',
    ],
  },
  {
    id: 'sharepoint-online',
    Connector: SharepointOnlineConnector,
    spec: SharepointOnlineConnectorSpec,
    operations: [
      'callGraphAPI',
      'downloadDriveItem',
      'downloadItemFromURL',
      'getAllSites',
      'getDriveItems',
      'getSite',
      'getSiteDrives',
      'getSiteListItems',
      'getSiteLists',
      'getSitePageContents',
      'getSitePages',
      'search',
    ],
  },
  {
    id: 'microsoft-teams',
    Connector: MicrosoftTeamsConnector,
    spec: MicrosoftTeamsConnectorSpec,
    operations: [
      'createChat',
      'getUser',
      'listChannelMessages',
      'listChannels',
      'listChatMessages',
      'listChats',
      'listJoinedTeams',
      'searchMessages',
      'sendChannelMessage',
      'sendChatMessage',
      'updateMessage',
    ],
  },
  {
    id: 'google_calendar',
    Connector: GoogleCalendarConnector,
    spec: GoogleCalendarConnectorSpec,
    operations: ['freeBusy', 'getEvent', 'listCalendars', 'listEvents', 'searchEvents'],
  },
  {
    id: 'google_drive',
    Connector: GoogleDriveConnector,
    spec: GoogleDriveConnectorSpec,
    operations: ['downloadFile', 'getFileMetadata', 'listFiles', 'searchFiles'],
  },
])('$id native routing', ({ id, Connector, spec, operations }) => {
  it('preserves all original handlers and EVERY declared auth mode', async () => {
    expect(Object.keys(spec.actions).sort()).toEqual([...operations].sort());
    const run = jest.fn();
    const runtime: SpecRuntimeApi = { run, drain: jest.fn(), close: jest.fn() };
    const signal = new AbortController().signal;
    const input = { connectorType: id };
    await new Connector(runtime).run('scope', input, { signal });
    expect(run).toHaveBeenCalledWith(
      spec,
      expect.objectContaining({ authTypes: expect.any(Array) }),
      'scope',
      input,
      signal
    );
    expect(
      run.mock.calls[0][1].authTypes.map((definition: { id: string }) => definition.id)
    ).toEqual(spec.auth?.types.map((entry) => (typeof entry === 'string' ? entry : entry.type)));
  });
});

it('does not invent an executor contribution for the ingress-only webhook spec', () => {
  expect(Object.keys(InboundWebhook.actions)).toEqual([]);
});

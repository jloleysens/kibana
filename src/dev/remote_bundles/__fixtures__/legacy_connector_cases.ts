/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License, v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';

export const legacyConnectorCases = (url: string) => [
  {
    type: 'd3security',
    op: 'run',
    legacy: true,
    config: { url: url + '/legacy/d3security' },
    secrets: { token: 'fake-key' },
    params: { body: JSON.stringify({ marker: 'local-business' }) },
  },
  {
    type: 'opsgenie',
    op: 'createAlert',
    legacy: true,
    config: { apiUrl: url },
    secrets: { apiKey: 'fake-key' },
    params: { message: 'local-business' },
  },
  {
    type: 'jira-service-management',
    op: 'createAlert',
    legacy: true,
    config: { apiUrl: url },
    secrets: { apiKey: 'fake-key' },
    params: { message: 'local-business' },
  },
  {
    type: 'tines',
    op: 'stories',
    legacy: true,
    config: { url: url + '/legacy/tines' },
    secrets: { email: 'fake@runner.invalid', token: 'fake-key' },
    params: {},
  },
  {
    type: 'xsoar',
    op: 'getPlaybooks',
    legacy: true,
    config: { url: url + '/legacy/xsoar' },
    secrets: { apiKey: 'fake-key' },
    params: {},
  },
  {
    type: 'resilient',
    op: '',
    legacy: true,
    config: { apiUrl: url + '/legacy/resilient', orgId: 'fake' },
    secrets: { apiKeyId: 'fake-key', apiKeySecret: 'fake-secret' },
    params: {
      subAction: 'pushToService',
      subActionParams: { incident: { name: 'local-business' }, comments: [] },
    },
  },
  {
    type: 'thehive',
    op: 'createAlert',
    legacy: true,
    config: { url: url + '/legacy/thehive' },
    secrets: { apiKey: 'fake-key' },
    params: {
      title: 'local-business',
      description: 'local-business',
      type: 'fake',
      source: 'fake',
      sourceRef: 'fake',
      isRuleSeverity: false,
    },
  },
];

/** Checks fake-only credentials and supplies provider-shaped responses, including empty outputs. */
export const legacyConnectorResponse = (
  request: IncomingMessage,
  text: string
): object | undefined => {
  const path = request.url ?? '';
  if (path === '/legacy/d3security') {
    assert.equal(request.headers.d3key, 'fake-key');
    assert(text.includes('local-business'));
    return { refid: 'local-business' };
  }
  if (path.startsWith('/v2/alerts') || path.includes('/integration/v2/alerts')) {
    assert(['GenieKey fake-key', 'fake-key'].includes(String(request.headers.authorization)));
    assert(text.includes('local-business'));
    return { took: 1, requestId: 'local-business', result: 'local-business' };
  }
  if (path.startsWith('/legacy/tines/')) {
    assert.equal(request.headers['x-user-token'], 'fake-key');
    assert.equal(request.headers['x-user-email'], 'fake@runner.invalid');
    return { meta: { pages: 1 }, stories: [{ id: 1, name: 'local-business', published: true }] };
  }
  if (path.startsWith('/legacy/xsoar/')) {
    assert.equal(request.headers.authorization, 'fake-key');
    return { playbooks: [{ id: 'local-business', name: 'local-business' }] };
  }
  if (path.startsWith('/legacy/resilient/')) {
    assert.equal(
      request.headers.authorization,
      'Basic ' + Buffer.from('fake-key:fake-secret').toString('base64')
    );
    assert(text.includes('local-business'));
    return { id: 17, create_date: 1700000000000 };
  }
  if (path === '/legacy/thehive/api/v1/alert') {
    assert.equal(request.headers.authorization, 'Bearer fake-key');
    assert(text.includes('local-business'));
    return {
      _id: 'local-business',
      _type: 'Alert',
      _createdBy: 'fake',
      _createdAt: 1700000000000,
      type: 'fake',
      source: 'fake',
      sourceRef: 'fake',
      title: 'local-business',
      description: 'local-business',
      severity: 1,
      severityLabel: 'LOW',
      date: 1700000000000,
      tlp: 2,
      tlpLabel: 'AMBER',
      pap: 2,
      papLabel: 'AMBER',
      observableCount: 0,
      status: 'New',
      stage: 'New',
      extraData: {},
      newDate: 1700000000000,
      timeToDetect: 0,
    };
  }
};

export const classicConnectorCases = (url: string, smtpPort: number) => [
  {
    type: 'http',
    op: '',
    legacy: true,
    config: { url: url + '/legacy/http', hasAuth: false, authType: null },
    secrets: {},
    params: { method: 'POST', body: { marker: 'local-business' } },
  },
  {
    type: 'email',
    op: '',
    legacy: true,
    config: {
      service: 'other',
      host: '127.0.0.1',
      port: smtpPort,
      secure: false,
      from: 'fake@runner.invalid',
      hasAuth: false,
    },
    secrets: {},
    params: {
      to: ['recipient@runner.invalid'],
      subject: 'local-business',
      message: 'local-business',
    },
  },
  {
    type: 'slack',
    op: '',
    legacy: true,
    config: {},
    secrets: { webhookUrl: url + '/legacy/slack' },
    params: { message: 'local-business' },
  },
  {
    type: 'slack_api',
    op: 'postMessage',
    legacy: true,
    config: { allowedChannels: [{ id: 'CFAKE', name: 'fake' }] },
    secrets: { token: 'fake-key' },
    params: { channelIds: ['CFAKE'], text: 'local-business' },
  },
  {
    type: 'teams',
    op: '',
    legacy: true,
    config: {},
    secrets: { webhookUrl: url + '/legacy/teams' },
    params: { message: 'local-business' },
  },
  {
    type: 'pagerduty',
    op: '',
    legacy: true,
    config: { apiUrl: url + '/legacy/pagerduty' },
    secrets: { routingKey: 'fake-key' },
    params: {
      eventAction: 'trigger',
      summary: 'local-business',
      severity: 'info',
      source: 'local-business',
    },
  },
  {
    type: 'torq',
    op: '',
    legacy: true,
    config: { webhookIntegrationUrl: 'https://hooks.torq.io/legacy/torq' },
    secrets: { token: 'fake-key' },
    params: { body: '{"marker":"local-business"}' },
  },
  {
    type: 'xmatters',
    op: '',
    legacy: true,
    config: { configUrl: url + '/legacy/xmatters', usesBasic: true },
    secrets: { user: 'fake-key', password: 'fake-secret' },
    params: { severity: 'local-business' },
  },
  {
    type: 'jira',
    op: 'issueTypes',
    legacy: true,
    config: { apiUrl: url + '/legacy/jira', projectKey: 'FAKE' },
    secrets: { email: 'fake-key', apiToken: 'fake-secret' },
    params: {},
  },
  {
    type: 'servicenow',
    op: '',
    legacy: true,
    config: { apiUrl: url + '/legacy/servicenow', usesTableApi: true },
    secrets: { username: 'fake-key', password: 'fake-secret' },
    params: { subAction: 'getChoices', subActionParams: { fields: ['state'] } },
  },
  {
    type: 'servicenow-itom',
    op: 'getChoices',
    legacy: true,
    config: { apiUrl: url + '/legacy/servicenow-itom' },
    secrets: { username: 'fake-key', password: 'fake-secret' },
    params: { fields: ['state'] },
  },
  {
    type: 'servicenow-sir',
    op: 'getChoices',
    legacy: true,
    config: { apiUrl: url + '/legacy/servicenow-sir', usesTableApi: true },
    secrets: { username: 'fake-key', password: 'fake-secret' },
    params: { fields: ['state'] },
  },
  {
    type: 'swimlane',
    op: 'pushToService',
    legacy: true,
    config: {
      apiUrl: url + '/legacy/swimlane',
      appId: 'fake',
      connectorType: 'all',
      mappings: {
        descriptionConfig: {
          id: 'fake',
          key: 'description',
          name: 'description',
          fieldType: 'text',
        },
      },
    },
    secrets: { apiToken: 'fake-key' },
    params: {
      incident: {
        ruleName: 'local-business',
        alertId: 'local-business',
        description: 'local-business',
      },
      comments: [],
    },
  },
];

export const classicConnectorResponse = (
  request: IncomingMessage,
  text: string
): object | undefined => {
  const path = request.url ?? '';
  if (path === '/legacy/http') {
    assert(text.includes('local-business'));
    return { marker: 'local-business' };
  }
  if (path === '/legacy/slack' || path === '/legacy/teams') {
    assert(text.includes('local-business'));
    return { marker: 'local-business' };
  }
  if (request.headers.host === 'slack.com' && path.startsWith('/api/chat.postMessage')) {
    assert.equal(request.headers.authorization, 'Bearer fake-key');
    return { ok: true, channel: 'CFAKE', ts: '1', message: { text: 'local-business' } };
  }
  if (path === '/legacy/pagerduty') {
    assert.equal(request.headers['x-routing-key'], 'fake-key');
    assert(text.includes('local-business'));
    return { status: 'success', dedup_key: 'local-business' };
  }
  if (path === '/legacy/torq') {
    assert.equal(request.headers['x-torq-token'], 'fake-key');
    assert(text.includes('local-business'));
    return { marker: 'local-business' };
  }
  if (
    path === '/legacy/xmatters' ||
    path.startsWith('/legacy/jira/') ||
    path.startsWith('/legacy/servicenow')
  ) {
    assert.equal(
      request.headers.authorization,
      'Basic ' + Buffer.from('fake-key:fake-secret').toString('base64')
    );
    if (path.startsWith('/legacy/jira/'))
      return { issueTypes: [{ id: 'local-business', name: 'local-business' }] };
    if (path.startsWith('/legacy/servicenow'))
      return {
        result: [{ element: 'state', value: '1', label: 'local-business', dependent_value: '' }],
      };
    assert(text.includes('local-business'));
    return { marker: 'local-business' };
  }
  if (path.startsWith('/legacy/swimlane/')) {
    assert(text.includes('local-business'));
    return { id: 'local-business', name: 'local-business', createdDate: 1700000000000 };
  }
};

export const mcpConnectorCase = (url: string) => ({
  type: 'mcp',
  op: 'callTool',
  legacy: true,
  config: { serverUrl: url + '/mcp', hasAuth: true, authType: 'bearer' },
  secrets: { token: 'fake-key' },
  params: { name: 'local-business', arguments: {} },
});

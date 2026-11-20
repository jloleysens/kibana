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
import { OnePasswordConnector } from './one_password';
import { OnePasswordConnector as OnePasswordConnectorSpec } from '../../src/specs/one_password/one_password';
import { ThreatqConnector } from './threatq';
import { ThreatQ as ThreatQSpec } from '../../src/specs/threatq/threatq';
import { OktaConnector } from './okta';
import { Okta as OktaSpec } from '../../src/specs/okta/okta';

describe.each([
  {
    id: '1password',
    Connector: OnePasswordConnector,
    spec: OnePasswordConnectorSpec,
    operations: ['getUser', 'listUsers', 'reactivateUser', 'suspendUser'],
  },
  {
    id: 'threatq',
    Connector: ThreatqConnector,
    spec: ThreatQSpec,
    operations: [
      'addAttribute',
      'addTags',
      'createAdversary',
      'createEvent',
      'createIndicator',
      'createObject',
      'executePlugin',
      'getIndicator',
      'getObject',
      'getPlugin',
      'getRelatedObjects',
      'linkObjects',
      'listIndicatorStatuses',
      'listIndicatorTypes',
      'listPlugins',
      'searchIndicators',
      'searchObjects',
      'updateIndicatorStatus',
    ],
  },
  {
    id: 'okta',
    Connector: OktaConnector,
    spec: OktaSpec,
    operations: [
      'activateUser',
      'addUserToGroup',
      'clearUserSessions',
      'deactivateUser',
      'expirePassword',
      'getLogs',
      'getUser',
      'getUserFactors',
      'getUserGroups',
      'listUsers',
      'removeUserFromGroup',
      'resetFactors',
      'resetPassword',
      'searchUsers',
      'suspendUser',
      'unsuspendUser',
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

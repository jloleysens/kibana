/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import * as runtime from '@kbn/connector-specs-runtime';
import * as publicApi from '..';
import * as authMaps from './auth_mode_by_auth_type_id';
import * as allAuthTypes from './all_auth_types';
import * as selection from './selected_actions';
import * as utils from './connector_utils';
import { TEST_CONNECTOR_SUB_ACTION } from './connector_spec';

const historicalNames = [
  'AUTH_MODE_BY_AUTH_TYPE_ID',
  'getAuthModeForAuthTypeId',
  'USES_RELAY_BY_AUTH_TYPE_ID',
  'authTypeUsesRelay',
  'isKibanaManagedAuthTypeId',
  'filterActionsBySelection',
  'formatConnectorActionLine',
  'getEffectiveScope',
  'isSelectedActionEnabled',
  'isSpecificActionsSelection',
  'resolveActionScope',
  'getConnectorActionErrorMeta',
  'setConnectorActionErrorMeta',
  'getFinitePositiveNumber',
  'getEstimatedBase64OutputBytes',
  'getHeaderValue',
  'getResponseContentLengthBytes',
  'ESTIMATED_JSON_OUTPUT_OVERHEAD_BYTES',
  'TEST_CONNECTOR_SUB_ACTION',
] as const;

it.each(historicalNames)('preserves the original public %s export identity', (name) => {
  expect(publicApi[name]).toBe(runtime[name]);
});

it('preserves every old-path export identity and the shared error metadata store', () => {
  for (const [name, value] of Object.entries({ ...selection, ...utils, ...authMaps })) {
    expect(Reflect.get(runtime, name)).toBe(value);
  }
  expect(utils.normalizeUrl).toBe(runtime.normalizeUrl);
  expect(authMaps.IS_KIBANA_MANAGED_BY_AUTH_TYPE_ID).toBe(
    runtime.IS_KIBANA_MANAGED_BY_AUTH_TYPE_ID
  );
  expect(TEST_CONNECTOR_SUB_ACTION).toBe(runtime.TEST_CONNECTOR_SUB_ACTION);
  const error = new Error('sized');
  utils.setConnectorActionErrorMeta(error, { contentLengthBytes: 17 });
  expect(runtime.getConnectorActionErrorMeta(error)).toEqual({ contentLengthBytes: 17 });
});

it('produces exactly the original auth maps from every registered authoring definition', () => {
  const specs = Object.values(allAuthTypes).filter((spec) => typeof spec.id === 'string');
  expect(runtime.AUTH_MODE_BY_AUTH_TYPE_ID).toEqual(
    Object.fromEntries(
      specs.map((spec) => [spec.id, 'authMode' in spec ? spec.authMode : 'shared'])
    )
  );
  expect(runtime.USES_RELAY_BY_AUTH_TYPE_ID).toEqual(
    Object.fromEntries(
      specs.map((spec) => [spec.id, 'usesRelayTransport' in spec ? spec.usesRelayTransport : false])
    )
  );
  expect(runtime.IS_KIBANA_MANAGED_BY_AUTH_TYPE_ID).toEqual(
    Object.fromEntries(
      specs.map((spec) => [spec.id, 'isKibanaManaged' in spec ? spec.isKibanaManaged : false])
    )
  );
  expect(Object.keys(runtime.AUTH_TYPE_METADATA).sort()).toEqual(specs.map(({ id }) => id).sort());
  expect(runtime.getAuthModeForAuthTypeId('unregistered')).toBe('shared');
  expect(runtime.authTypeUsesRelay('unregistered')).toBe(false);
  expect(runtime.isKibanaManagedAuthTypeId('unregistered')).toBe(false);
});

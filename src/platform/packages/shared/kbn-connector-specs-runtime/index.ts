/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

export { TEST_CONNECTOR_SUB_ACTION } from './types';
export type { AuthMode, ActionScope } from './types';
export { AUTH_TYPE_METADATA } from './auth_type_metadata';
export {
  filterActionsBySelection,
  formatConnectorActionLine,
  getEffectiveScope,
  isSelectedActionEnabled,
  isSpecificActionsSelection,
  resolveActionScope,
} from './selected_actions';
export type { SelectedActions } from './selected_actions';
export {
  normalizeUrl,
  getConnectorActionErrorMeta,
  setConnectorActionErrorMeta,
  getFinitePositiveNumber,
  getEstimatedBase64OutputBytes,
  getHeaderValue,
  getResponseContentLengthBytes,
  ESTIMATED_JSON_OUTPUT_OVERHEAD_BYTES,
} from './connector_utils';
export type { ConnectorActionErrorMeta } from './connector_utils';
export {
  AUTH_MODE_BY_AUTH_TYPE_ID,
  getAuthModeForAuthTypeId,
  USES_RELAY_BY_AUTH_TYPE_ID,
  authTypeUsesRelay,
  IS_KIBANA_MANAGED_BY_AUTH_TYPE_ID,
  isKibanaManagedAuthTypeId,
} from './auth_mode_by_auth_type_id';
export { ConnectorAuthorizationError } from './connector_authorization_error';
export type { ConnectorAuthorizationReason } from './connector_authorization_error';
export { normalizeAuthorizationHeaderValue } from './normalize_authorization_header_value';
export {
  OAUTH_AUTHORIZATION_CODE_AUTH_ID,
  EARS_AUTH_ID,
  EARS_PROVIDERS,
  CLIENT_ASSERTION_TYPE,
} from './auth_constants';

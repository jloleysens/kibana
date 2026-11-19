/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { AUTH_TYPE_METADATA } from './auth_type_metadata';
export const OAUTH_AUTHORIZATION_CODE_AUTH_ID = AUTH_TYPE_METADATA.oauth_authorization_code.id;
export const EARS_AUTH_ID = AUTH_TYPE_METADATA.ears.id;
export const EARS_PROVIDERS = ['google', 'microsoft', 'slack'] as const;
export const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

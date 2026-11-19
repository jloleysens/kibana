/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import isString from 'lodash/isString';
import { EARS_AUTH_ID } from '../auth_types/ears';
import type { AuthTypeDef } from '../connector_spec';

export const isEarsExperimentalAuthType = (
  authType: string | AuthTypeDef
): authType is AuthTypeDef =>
  !isString(authType) && authType.type === EARS_AUTH_ID && authType.isExperimental === true;

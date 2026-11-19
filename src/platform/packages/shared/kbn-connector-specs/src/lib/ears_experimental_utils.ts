/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import * as allSpecs from '../all_specs';
import { isEarsExperimentalAuthType } from './is_ears_experimental_auth_type';
export { isEarsExperimentalAuthType } from './is_ears_experimental_auth_type';

const experimentalEarsConnectorIds = new Set(
  Object.values(allSpecs)
    .filter((spec) => spec.auth?.types.some(isEarsExperimentalAuthType))
    .map((spec) => spec.metadata.id)
);

export const isEarsExperimentalConnector = (connectorTypeId: string): boolean =>
  experimentalEarsConnectorIds.has(connectorTypeId);

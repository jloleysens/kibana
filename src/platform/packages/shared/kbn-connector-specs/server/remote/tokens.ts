/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { createToken } from '@kbn/core-di';
import type { ConnectorSpec, NormalizedAuthType } from '../../src/connector_spec';

export interface SpecRuntimeServices {
  readonly authTypes: readonly NormalizedAuthType[];
  readonly isConnectorAuthorizationError: typeof import('../../src/errors/connector_authorization_error').isConnectorAuthorizationError;
}

export interface SpecRuntimeApi {
  run(
    spec: ConnectorSpec,
    services: SpecRuntimeServices,
    scopeId: string,
    input: unknown,
    signal?: AbortSignal
  ): Promise<unknown>;
  drain(scopeId: string): Promise<void>;
  close(scopeId: string): Promise<void>;
}
export const SpecRuntimeToken = createToken<SpecRuntimeApi>('actions.specRuntime');

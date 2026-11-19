/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { inject } from 'inversify';
import { isConnectorAuthorizationError } from '../../src/errors/connector_authorization_error';
import { Box as OriginalSpec } from '../../src/specs/box/box';
import type { NormalizedAuthType } from '../../src/connector_spec';
import { OAuthAuthorizationCode } from '../../src/auth_types/oauth_authorization_code';
import { SpecRuntimeToken, type SpecRuntimeApi } from './tokens';

export class BoxConnector {
  constructor(@inject(SpecRuntimeToken) private readonly runtime: SpecRuntimeApi) {}
  async run(
    scopeId: string,
    input: unknown,
    context: { readonly signal?: AbortSignal }
  ): Promise<unknown> {
    return this.runtime.run(
      OriginalSpec,
      { authTypes: [OAuthAuthorizationCode as NormalizedAuthType], isConnectorAuthorizationError },
      scopeId,
      input,
      context.signal
    );
  }
}

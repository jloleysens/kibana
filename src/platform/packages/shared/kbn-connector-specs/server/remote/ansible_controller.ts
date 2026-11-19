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
import { AnsibleControllerConnector as OriginalSpec } from '../../src/specs/ansible_controller/ansible_controller';
import type { NormalizedAuthType } from '../../src/connector_spec';
import { BearerWithTlsAuth } from '../../src/auth_types/bearer_with_tls_server';
import { SpecRuntimeToken, type SpecRuntimeApi } from './tokens';

export class AnsibleControllerConnector {
  constructor(@inject(SpecRuntimeToken) private readonly runtime: SpecRuntimeApi) {}
  async run(
    scopeId: string,
    input: unknown,
    context: { readonly signal?: AbortSignal }
  ): Promise<unknown> {
    return this.runtime.run(
      OriginalSpec,
      { authTypes: [BearerWithTlsAuth as NormalizedAuthType], isConnectorAuthorizationError },
      scopeId,
      input,
      context.signal
    );
  }
}

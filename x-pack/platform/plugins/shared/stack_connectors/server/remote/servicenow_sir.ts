/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import { SpecRuntimeToken } from '@kbn/actions-plugin/server/remote/tokens';
import type { SpecRuntime } from '@kbn/actions-plugin/server/remote/spec_runtime';
import { getServiceNowSIRConnectorType } from '../connector_types/servicenow_sir/get_connector_type';

export class ServiceNowSIRConnector {
  constructor(@inject(SpecRuntimeToken) private readonly runtime: SpecRuntime) {}
  async run(
    scopeId: string,
    input: unknown,
    context: { readonly signal?: AbortSignal }
  ): Promise<unknown> {
    return this.runtime.runClassic(
      'servicenow-sir',
      () => getServiceNowSIRConnectorType(),
      scopeId,
      input,
      context.signal
    );
  }
}

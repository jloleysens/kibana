/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import { SpecRuntimeToken } from '@kbn/actions-plugin/server/remote/tokens';
import type { SpecRuntime } from '@kbn/actions-plugin/server/remote/spec_runtime';
import type { SubActionServices } from '@kbn/actions-plugin/server/sub_action_framework/types';
import { getOpsgenieConnectorType } from '../connector_types/opsgenie/get_connector_type';
import { WorkflowDataPlaneToken, type ConnectorDataPlane } from './tokens';

export class OpsgenieConnector {
  constructor(
    @inject(SpecRuntimeToken) private readonly runtime: SpecRuntime,
    @inject(WorkflowDataPlaneToken) private readonly data: ConnectorDataPlane
  ) {}
  async run(
    scopeId: string,
    input: unknown,
    context: { readonly signal?: AbortSignal }
  ): Promise<unknown> {
    return this.runtime.runLegacy(
      getOpsgenieConnectorType<SubActionServices>(),
      { scopedClusterClient: this.data.user(scopeId) },
      scopeId,
      input,
      context.signal
    );
  }
}

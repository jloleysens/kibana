/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import { SpecRuntimeToken } from '@kbn/actions-plugin/server/remote/tokens';
import type { SpecRuntime } from '@kbn/actions-plugin/server/remote/spec_runtime';
import { LeasePool } from '@kbn/actions-plugin/server/lib/lease_pool';
import type { SubActionServices } from '@kbn/actions-plugin/server/sub_action_framework/types';
import { getMcpConnectorType } from '../connector_types/mcp';
import { WorkflowDataPlaneToken, type ConnectorDataPlane } from './tokens';

export class McpConnector {
  constructor(
    @inject(SpecRuntimeToken) private readonly runtime: SpecRuntime,
    @inject(WorkflowDataPlaneToken) private readonly data: ConnectorDataPlane
  ) {}
  async run(
    scopeId: string,
    input: unknown,
    context: { readonly signal?: AbortSignal }
  ): Promise<unknown> {
    const pool = new LeasePool<unknown>();
    const connector = getMcpConnectorType<SubActionServices>({ getClientLeasePool: () => pool });
    let connectorId: string | undefined;
    try {
      return await this.runtime.runLegacy(
        {
          ...connector,
          getService: (params) => {
            connectorId = params.connector.id;
            return connector.getService(params);
          },
        },
        { scopedClusterClient: this.data.user(scopeId) },
        scopeId,
        input,
        context.signal
      );
    } finally {
      if (connectorId) await pool.evict(connectorId);
    }
  }
}

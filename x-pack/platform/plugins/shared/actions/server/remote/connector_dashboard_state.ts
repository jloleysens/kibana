/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SavedObjectsClientContract } from '@kbn/core/server';
import type { ConnectorDashboardRequest, ConnectorDashboardResponse } from './types';

/** Limits dashboard access to the prepared LLM subaction and its requested dashboard ID. */
export class ConnectorDashboardState {
  private closed = false;
  private readonly dashboardId?: string;
  constructor(
    private readonly client: Pick<SavedObjectsClientContract, 'get' | 'create'>,
    type: string,
    params: Record<string, unknown>,
    private readonly signal: AbortSignal,
    private readonly getAttributes?: (
      id: string
    ) => import('@kbn/core/server').SavedObjectAttributes
  ) {
    const subParams = params.subActionParams;
    if (
      ['.gen-ai', '.bedrock', '.gemini', '.inference'].includes(type) &&
      params.subAction === 'getDashboard' &&
      subParams &&
      typeof subParams === 'object' &&
      'dashboardId' in subParams &&
      typeof subParams.dashboardId === 'string' &&
      subParams.dashboardId.length <= 1024
    ) {
      this.dashboardId = subParams.dashboardId;
    }
  }
  close(): void {
    this.closed = true;
  }
  async execute(request: ConnectorDashboardRequest): Promise<ConnectorDashboardResponse> {
    this.signal.throwIfAborted();
    if (this.closed || !this.dashboardId || !this.getAttributes)
      throw new Error('Dashboard access is not available for this invocation');
    const id = this.dashboardId;
    try {
      const value =
        request.operation === 'get'
          ? await this.client.get('dashboard', id)
          : await this.client.create('dashboard', this.getAttributes(id), { id, overwrite: true });
      return { value };
    } catch (error) {
      return {
        error: {
          message: error.message,
          statusCode: error.output?.statusCode ?? 500,
          error: error.output?.payload?.error ?? 'Error',
        },
      };
    }
  }
}

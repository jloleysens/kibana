/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { inject } from 'inversify';
import { remotable } from '@kbn/core-remote-common';
import type { NormalizedAuthType } from '@kbn/connector-specs';
import type { NativeActionsApi } from '@kbn/actions-plugin/server/remote/types';
import { SpecRuntime } from '@kbn/actions-plugin/server/remote/spec_runtime';
import { BasicAuth } from '@kbn/connector-specs/src/auth_types/basic';
import { ApiKeyHeaderAuth } from '@kbn/connector-specs/src/auth_types/api_key_header';
import { MysqlConnector } from '@kbn/connector-specs/src/specs/mysql/mysql';
import { PagerdutyConnector } from '@kbn/connector-specs/src/specs/pagerduty/pagerduty';
import { isConnectorAuthorizationError } from '@kbn/connector-specs/server/remote/connector_authorization_error';
import { ClientActionsToken } from './tokens';

@remotable()
export class ClientRoot {
  private readonly runtime: SpecRuntime;
  constructor(@inject(ClientActionsToken) actions: NativeActionsApi) {
    this.runtime = new SpecRuntime(actions);
  }
  async warm(): Promise<void> {
    await import('@kbn/actions-plugin/server/remote/spec_runtime_impl');
    await import('@kbn/connector-specs/src/lib/mcp/with_mcp_client');
  }
  async run(scopeId: string, type: 'mcp' | 'mysql'): Promise<object> {
    const spec =
      type === 'mysql'
        ? MysqlConnector
        : {
            ...PagerdutyConnector,
            actions: {
              listTools: {
                ...PagerdutyConnector.actions.listTools,
                handler: async (ctx: import('@kbn/connector-specs').ActionContext) =>
                  (await ctx.getClient('mcp')).listTools(),
              },
            },
          };
    global.gc?.();
    const before = process.memoryUsage().heapUsed;
    const result = await this.runtime.run(
      spec,
      {
        authTypes: [BasicAuth, ApiKeyHeaderAuth] as NormalizedAuthType[],
        isConnectorAuthorizationError,
      },
      scopeId,
      {
        connectorType: spec.metadata.id.replace(/^\./, ''),
        connectorNameOrId: type,
        input: {},
        system: false,
      }
    );
    await this.runtime.close(scopeId);
    global.gc?.();
    return { result, pid: process.pid, heapIncrement: process.memoryUsage().heapUsed - before };
  }
}

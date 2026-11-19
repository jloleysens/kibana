/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { writeFileSync } from 'node:fs';
import type {
  ConnectorFinalization,
  NativeActionsApi,
  PreparedConnector,
} from '@kbn/actions-plugin/server/remote/types';

export class ClientActions implements NativeActionsApi {
  readonly finalizations: ConnectorFinalization[] = [];
  constructor(
    private readonly prepared: Readonly<Record<string, PreparedConnector>>,
    private readonly path: string
  ) {}
  async prepare(
    _scope: string,
    _invocation: string,
    request: Parameters<NativeActionsApi['prepare']>[2]
  ) {
    const prepared = this.prepared[request.connectorType];
    if (!prepared) throw new Error('Unknown fixture connector');
    return { prepared };
  }
  async finalize(_scope: string, batch: ConnectorFinalization[]): Promise<void> {
    this.finalizations.push(...batch);
    writeFileSync(this.path, JSON.stringify(this.finalizations));
  }
  async finalizeRetry(): Promise<never> {
    throw new Error('No failed fixture batch to retry');
  }
  async token(): Promise<never> {
    throw new Error('Token access is unavailable in this fixture');
  }
  async dashboard(): Promise<never> {
    throw new Error('Dashboard access is unavailable in this fixture');
  }
  async relay(): Promise<never> {
    throw new Error('Relay access is unavailable in this fixture');
  }
}

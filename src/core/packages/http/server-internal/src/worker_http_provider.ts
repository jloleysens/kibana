/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { HttpSelfClientDispatchConfig } from '@kbn/core-http-server';
import type { Logger } from '@kbn/logging';

type Implementation = typeof import('./worker_http_service');
let implementation: Promise<Implementation> | undefined;

/** An eager-load-safe provider shell; shared code is cached, run identities are not. */
export class WorkerHttpProvider {
  async create(
    config: HttpSelfClientDispatchConfig,
    log: Logger,
    identity: { readonly authorization: string; readonly uiamAttestation?: string }
  ) {
    implementation ??= import('./worker_http_service').catch((error) => {
      implementation = undefined;
      throw error;
    });
    return (await implementation).createWorkerHttpService(config, log, identity);
  }
}

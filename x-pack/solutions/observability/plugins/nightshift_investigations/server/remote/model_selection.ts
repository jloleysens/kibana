/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import type { ModelSelectionApi, ModelSelectionInput } from './model_selection_tokens';
import type { createModelResolver } from './model_resolution';
import { createInvestigationTransportError } from './investigation_errors';

/** Original scoped SO/UI model policy stays coordinator-owned; no client or setting cache crosses runs. */
@remotable()
export class ModelSelection implements ModelSelectionApi {
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly resolveModel: ReturnType<typeof createModelResolver>
  ) {}
  async resolve(
    scopeId: string,
    input: ModelSelectionInput
  ): ReturnType<ModelSelectionApi['resolve']> {
    const started = performance.now();
    const cpu = process.cpuUsage();
    try {
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      const request = this.scopes.get<KibanaRequest>(scopeId);
      this.scopes.getRunState(scopeId);
      const { step, connector_id, round_connector_id } = input;
      if (step !== 'investigation') throw new Error('Unknown Nightshift model step');
      const result = await this.resolveModel(request, { step, connector_id, round_connector_id });
      signal.throwIfAborted();
      return result;
    } catch (error) {
      throw createInvestigationTransportError(error);
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('nightshift_model_selection', {
        scopeId,
        durationMs: performance.now() - started,
        payloadBytes: Buffer.byteLength(JSON.stringify(input)),
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }
}

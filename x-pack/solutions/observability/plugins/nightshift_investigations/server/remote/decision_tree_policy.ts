/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ScopeLookup } from '@kbn/core-remote-server';
import { recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import type {
  DecisionTreePolicyApi,
  DecisionTreePolicySnapshot,
} from './decision_tree_policy_tokens';
import { createInvestigationTransportError } from './investigation_errors';

@remotable()
export class DecisionTreePolicy implements DecisionTreePolicyApi {
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly getPolicy: () => DecisionTreePolicySnapshot
  ) {}
  async read(scopeId: string): Promise<DecisionTreePolicySnapshot> {
    const started = performance.now();
    const cpu = process.cpuUsage();
    try {
      this.scopes.getAbortSignal(scopeId).throwIfAborted();
      this.scopes.getRunState(scopeId);
      const { enabled, telemetryConnectorId } = this.getPolicy();
      this.scopes.getAbortSignal(scopeId).throwIfAborted();
      return { enabled, telemetryConnectorId };
    } catch (error) {
      throw createInvestigationTransportError(error);
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('nightshift_decision_tree_policy', {
        scopeId,
        durationMs: performance.now() - started,
        payloadBytes: Buffer.byteLength(JSON.stringify({ scopeId })),
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'node:crypto';
import { lazySchema, z } from '@kbn/zod/v4';
import type { ScopeLookup } from '@kbn/core-remote-server';
import type { Logger } from '@kbn/logging';
import { remotable } from '@kbn/core-remote-common';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import type { ModelObservationsApi } from './model_observations_api';

type IssuedObservation = Awaited<
  ReturnType<AgentBuilderPluginStart['runtime']['issueModelObservation']>
>;
interface ObservationLease {
  scopeId: string;
  stepId: string;
  registration: Registration;
}
interface Registration {
  connectorId: string;
  stepType: string;
  observation: IssuedObservation;
}
const tokenCount = lazySchema(() => z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const completionSchema = lazySchema(() =>
  z.strictObject({
    model: z.string().max(500).optional(),
    tokens: z
      .strictObject({
        prompt: tokenCount,
        completion: tokenCount,
        total: tokenCount,
        thinking: tokenCount.optional(),
        cached: tokenCount.optional(),
        cacheWrite: tokenCount.optional(),
      })
      .optional(),
  })
);

@remotable()
export class ModelObservations implements ModelObservationsApi {
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly registrations: Map<string, Map<string, Registration>>,
    private readonly logger: Pick<Logger, 'debug'>,
    private readonly leases: Map<string, ObservationLease>,
    private readonly releaseScope: (scopeId: string) => void,
    private readonly isDrained: () => boolean
  ) {}
  async open(
    scopeId: string,
    stepId: string,
    connectorId: string
  ): ReturnType<ModelObservationsApi['open']> {
    if (this.isDrained()) throw new Error('Model observation host is drained');
    const signal = this.scopes.getAbortSignal(scopeId);
    signal.throwIfAborted();
    this.scopes.getRunState(scopeId);
    const registration = this.registrations.get(scopeId)?.get(stepId);
    if (
      !registration ||
      registration.connectorId !== connectorId ||
      registration.stepType !== this.scopes.resolveStepType(scopeId, stepId)
    ) {
      throw new Error('Model observation is not registered for this run and step');
    }
    const lease = randomUUID();
    this.leases.set(lease, { scopeId, stepId, registration });
    return { lease, metadata: registration.observation.metadata };
  }
  async report(
    scopeId: string,
    lease: string,
    event: Parameters<ModelObservationsApi['report']>[2]
  ): Promise<void> {
    const pending = this.leases.get(lease);
    if (
      !pending ||
      pending.scopeId !== scopeId ||
      this.registrations.get(scopeId)?.get(pending.stepId) !== pending.registration
    ) {
      this.logger.debug('Dropped unknown, settled or foreign model observation');
      return;
    }
    // Consume before validation/callback, including concurrent or malformed replays.
    this.leases.delete(lease);
    const result = completionSchema.safeParse(event);
    if (!result.success) {
      this.logger.debug('Dropped malformed model observation');
      return;
    }
    try {
      pending.registration.observation.complete(result.data);
    } catch (error) {
      this.logger.debug('Model observation tracking failed');
    }
  }
  async settle(scopeId: string, stepId: string): Promise<void> {
    this.registrations.get(scopeId)?.delete(stepId);
    if (!this.registrations.get(scopeId)?.size) this.releaseScope(scopeId);
    for (const [lease, pending] of this.leases) {
      if (pending.scopeId === scopeId && pending.stepId === stepId) this.leases.delete(lease);
    }
  }
}

/** Keeps registration outside the RPC object's discoverable prototype. */
export const createModelObservations = (scopes: ScopeLookup, logger: Pick<Logger, 'debug'>) => {
  const registrations = new Map<string, Map<string, Registration>>();
  const leases = new Map<string, ObservationLease>();
  const cleanups = new Map<string, () => void>();
  let drained = false;
  const releaseScope = (scopeId: string): void => {
    registrations.delete(scopeId);
    cleanups.get(scopeId)?.();
    cleanups.delete(scopeId);
    for (const [lease, pending] of leases) {
      if (pending.scopeId === scopeId) leases.delete(lease);
    }
  };
  const api = new ModelObservations(
    scopes,
    registrations,
    logger,
    leases,
    releaseScope,
    () => drained
  );
  return {
    api,
    drain: (): void => {
      drained = true;
      for (const scopeId of registrations.keys()) releaseScope(scopeId);
      leases.clear();
    },
    issue: (
      scopeId: string,
      stepId: string,
      connectorId: string,
      observation: IssuedObservation
    ): void => {
      if (drained) throw new Error('Model observation host is drained');
      const signal = scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      scopes.getRunState(scopeId);
      const stepType = scopes.resolveStepType(scopeId, stepId);
      let entries = registrations.get(scopeId);
      if (!entries) {
        entries = new Map();
        registrations.set(scopeId, entries);
        const onAbort = () => releaseScope(scopeId);
        signal.addEventListener('abort', onAbort, { once: true });
        cleanups.set(scopeId, () => signal.removeEventListener('abort', onAbort));
      }
      entries.set(stepId, { connectorId, stepType, observation });
    },
  };
};

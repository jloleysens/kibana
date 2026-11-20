/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { createPersistDiscoveriesHandler } from '../workflows/steps/persist_discoveries_step/persist_discoveries_handler';
import {
  AttackDiscoveryOperationsToken,
  type AttackDiscoveryOperationsApi,
  type ValidationDiagnostic,
} from './tokens';
import { restoreAttackDiscoveryError } from './errors';
import { createValidationLogger } from './validation_logger';
export class PersistDiscoveriesStep implements RemoteWorkflowStep {
  constructor(
    @inject(AttackDiscoveryOperationsToken) private readonly api: AttackDiscoveryOperationsApi
  ) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    if (!context.handlerContext)
      throw new Error('Attack discovery persistence requires executor-local handler context');
    const enabled = await restoreAttackDiscoveryError(this.api.checkEnabled(scopeId));
    const records: ValidationDiagnostic[] = [];
    const handler = createPersistDiscoveriesHandler({
      logger: createValidationLogger(enabled, records),
      persist: (input) => restoreAttackDiscoveryError(this.api.persist(scopeId, input)),
    });
    recordRemoteTiming('attack_discovery_persist_native_handler', { scopeId });
    try {
      return await handler(context.handlerContext as Parameters<typeof handler>[0]);
    } finally {
      await restoreAttackDiscoveryError(this.api.validationDiagnostics(scopeId, records));
    }
  }
}

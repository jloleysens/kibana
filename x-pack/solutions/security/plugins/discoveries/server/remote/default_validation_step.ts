/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { createDefaultValidationHandler } from '../workflows/steps/default_validation_step/default_validation_handler';
import {
  AttackDiscoveryOperationsToken,
  type AttackDiscoveryOperationsApi,
  type ValidationDiagnostic,
} from './tokens';
import { createValidationLogger } from './validation_logger';

import { restoreAttackDiscoveryError } from './errors';

export class DefaultValidationStep implements RemoteWorkflowStep {
  constructor(
    @inject(AttackDiscoveryOperationsToken) private readonly api: AttackDiscoveryOperationsApi
  ) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    if (!context.handlerContext)
      throw new Error('Attack discovery validation requires executor-local handler context');
    const { handlerContext } = context;
    const enabled = await restoreAttackDiscoveryError(this.api.checkEnabled(scopeId));
    const records: ValidationDiagnostic[] = [];
    const handler = createDefaultValidationHandler({
      logger: createValidationLogger(enabled, records),
      prepare: async (localContext) => {
        const facts = await restoreAttackDiscoveryError(
          this.api.prepareValidation(scopeId, {
            api_config: localContext.input.api_config,
            connector_name: localContext.input.connector_name,
          })
        );
        return { ...facts, esClient: await handlerContext.contextManager.getScopedEsClient() };
      },
    });
    recordRemoteTiming('attack_discovery_validation_native_handler', { scopeId });
    try {
      return await handler(handlerContext as Parameters<typeof handler>[0]);
    } finally {
      await restoreAttackDiscoveryError(this.api.validationDiagnostics(scopeId, records));
    }
  }
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { createGenerateHandler } from '../workflows/steps/generate_step/generate_handler';
import { AttackDiscoveryOperationsToken, type AttackDiscoveryOperationsApi } from './tokens';
import { restoreAttackDiscoveryError } from './errors';

export class GenerateStep implements RemoteWorkflowStep {
  constructor(
    @inject(AttackDiscoveryOperationsToken) private readonly api: AttackDiscoveryOperationsApi
  ) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    if (!context.handlerContext)
      throw new Error('Attack discovery generation requires executor-local handler context');
    const { handlerContext } = context;
    await restoreAttackDiscoveryError(this.api.checkEnabled(scopeId));
    let reference: string | undefined;
    let cancellation: Promise<void> | undefined;
    const abort = () => {
      if (reference !== undefined)
        cancellation = restoreAttackDiscoveryError(
          this.api.closeGeneration(scopeId, reference)
        ).catch((error: Error) => {
          handlerContext.logger.debug('Attack discovery generation cancellation: ' + error.message);
        });
    };
    const handler = createGenerateHandler(async (localContext) => {
      const prepared = await restoreAttackDiscoveryError(
        this.api.openGeneration(scopeId, handlerContext.stepId, localContext.input.api_config)
      );
      reference = prepared.reference;
      if (handlerContext.abortSignal.aborted) abort();
      return {
        executionUuid: prepared.executionUuid,
        invoke: (input) =>
          restoreAttackDiscoveryError(this.api.generate(scopeId, prepared.reference, input)),
      };
    });
    handlerContext.abortSignal.addEventListener('abort', abort, { once: true });
    recordRemoteTiming('attack_discovery_generate_native_handler', { scopeId });
    try {
      return await handler(handlerContext as Parameters<typeof handler>[0]);
    } finally {
      handlerContext.abortSignal.removeEventListener('abort', abort);
      await cancellation;
      if (reference !== undefined)
        await restoreAttackDiscoveryError(this.api.closeGeneration(scopeId, reference));
    }
  }
}

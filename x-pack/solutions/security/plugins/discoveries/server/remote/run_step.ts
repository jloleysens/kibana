/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { createRunHandler } from '../workflows/steps/run_step/run_handler';
import { AttackDiscoveryOperationsToken, type AttackDiscoveryOperationsApi } from './tokens';
import { restoreAttackDiscoveryError } from './errors';
export class RunStep implements RemoteWorkflowStep {
  constructor(
    @inject(AttackDiscoveryOperationsToken) private readonly api: AttackDiscoveryOperationsApi
  ) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    if (!context.handlerContext)
      throw new Error('Attack discovery run requires executor-local handler context');
    const { handlerContext } = context;
    await restoreAttackDiscoveryError(this.api.checkEnabled(scopeId));
    let reference: string | undefined;
    let cancellation: Promise<void> | undefined;
    const abort = () => {
      if (reference !== undefined)
        cancellation = restoreAttackDiscoveryError(this.api.cancelRun(scopeId, reference)).catch(
          (error: Error) => {
            handlerContext.logger.debug('Attack discovery run cancellation: ' + error.message);
          }
        );
    };
    const handler = createRunHandler(async (input) => {
      const prepared = await restoreAttackDiscoveryError(
        this.api.openRun(scopeId, handlerContext.stepId, input)
      );
      reference = prepared.reference;
      if (handlerContext.abortSignal.aborted) abort();
      return {
        ...prepared,
        execute: async (params) => {
          const outcome = await restoreAttackDiscoveryError(
            this.api.startRun(scopeId, prepared.reference, params, 'sync')
          );
          if (!outcome) throw new Error('Missing attack discovery run outcome');
          return outcome;
        },
        launch: async (params) => {
          await restoreAttackDiscoveryError(
            this.api.startRun(scopeId, prepared.reference, params, 'async')
          );
        },
      };
    });
    handlerContext.abortSignal.addEventListener('abort', abort, { once: true });
    recordRemoteTiming('attack_discovery_run_native_handler', { scopeId });
    try {
      return await handler(handlerContext as Parameters<typeof handler>[0]);
    } finally {
      handlerContext.abortSignal.removeEventListener('abort', abort);
      await cancellation;
      if (reference !== undefined)
        await restoreAttackDiscoveryError(this.api.finishRun(scopeId, reference));
    }
  }
}

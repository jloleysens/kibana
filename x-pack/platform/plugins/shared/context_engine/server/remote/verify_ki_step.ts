/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { createVerifyKiHandler } from '../step_types/verify_ki_handler';
import { KiOperationsToken, type KiOperationsApi } from './ki_tokens';
import { FeedbackOperationsToken, type FeedbackOperationsApi } from './feedback_tokens';
import { verifyKiForStep } from './verify_ki_operation';
import { restoreKiError } from './ki_errors';

export class VerifyKiStep implements RemoteWorkflowStep {
  constructor(
    @inject(KiOperationsToken) private readonly api: KiOperationsApi,
    @inject(FeedbackOperationsToken) private readonly settings: FeedbackOperationsApi
  ) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext) throw new Error('KI verification requires executor-local handler context');
    const handler = createVerifyKiHandler(
      () => restoreKiError(this.settings.isContextEngineEnabled(scopeId)),
      (params) => verifyKiForStep(this.api, scopeId, handlerContext, params)
    );
    recordRemoteTiming('context_engine_verify_native_handler', { scopeId });
    return handler(context.handlerContext as Parameters<typeof handler>[0]);
  }
}

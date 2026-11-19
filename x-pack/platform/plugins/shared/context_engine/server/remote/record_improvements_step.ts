/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { createRecordImprovementsHandler } from '../step_types/record_improvements_handler';
import {
  RecordImprovementsOperationsToken,
  type RecordImprovementsOperationsApi,
} from './record_improvements_tokens';
import { FeedbackOperationsToken, type FeedbackOperationsApi } from './feedback_tokens';
import { restoreKiError } from './ki_errors';

export class RecordImprovementsStep implements RemoteWorkflowStep {
  constructor(
    @inject(RecordImprovementsOperationsToken)
    private readonly api: RecordImprovementsOperationsApi,
    @inject(FeedbackOperationsToken) private readonly settings: FeedbackOperationsApi
  ) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    if (!context.handlerContext)
      throw new Error('Record improvements requires executor-local handler context');
    const handler = createRecordImprovementsHandler({
      assertEnabled: () => restoreKiError(this.api.assertEnabled(scopeId)),
      isFeedbackLoopEnabled: () => restoreKiError(this.settings.isFeedbackLoopEnabled(scopeId)),
      checkWritePrivilege: () => restoreKiError(this.api.checkWritePrivilege(scopeId)),
      record: (params) => restoreKiError(this.api.record(scopeId, params)),
    });
    recordRemoteTiming('context_engine_record_native_handler', { scopeId });
    return handler(context.handlerContext as Parameters<typeof handler>[0]);
  }
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RemoteModule } from '@kbn/core-remote-common';
import { RecordImprovementsOperationsToken } from './record_improvements_tokens';
import { KiOperationsToken } from './ki_tokens';
import { FeedbackOperationsToken, WorkflowStepKind } from './feedback_tokens';

export const remoteModule: RemoteModule = {
  providers: [
    {
      token: RecordImprovementsOperationsToken,
      placement: 'coordinator',
      modulePath: require.resolve('./record_improvements_operations'),
      exportName: 'RecordImprovementsOperations',
    },
    {
      token: KiOperationsToken,
      placement: 'coordinator',
      modulePath: require.resolve('./ki_operations'),
      exportName: 'KiOperations',
    },
    {
      token: FeedbackOperationsToken,
      placement: 'coordinator',
      modulePath: require.resolve('./feedback_operations'),
      exportName: 'FeedbackOperations',
    },
  ],
  contributions: [
    {
      kind: WorkflowStepKind,
      stepType: 'context-engine.recordImprovements',
      needs: [RecordImprovementsOperationsToken, FeedbackOperationsToken],
      modulePath: require.resolve('./record_improvements_step'),
      exportName: 'RecordImprovementsStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'context-engine.verifyKi',
      needs: [KiOperationsToken, FeedbackOperationsToken],
      modulePath: require.resolve('./verify_ki_step'),
      exportName: 'VerifyKiStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'context-engine.createKi',
      needs: [KiOperationsToken],
      modulePath: require.resolve('./create_ki_step'),
      exportName: 'CreateKiStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'context-engine.updateKi',
      needs: [KiOperationsToken],
      modulePath: require.resolve('./update_ki_step'),
      exportName: 'UpdateKiStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'context-engine.deleteKi',
      needs: [KiOperationsToken],
      modulePath: require.resolve('./delete_ki_step'),
      exportName: 'DeleteKiStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'context-engine.getFeedbackContext',
      needs: [FeedbackOperationsToken],
      modulePath: require.resolve('./feedback_context_step'),
      exportName: 'FeedbackContextStep',
    },
  ],
};

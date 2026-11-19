/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RemoteModule } from '@kbn/core-remote-common';
import { FeedbackOperationsToken, WorkflowStepKind } from './feedback_tokens';

export const remoteModule: RemoteModule = {
  providers: [
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
      stepType: 'context-engine.getFeedbackContext',
      needs: [FeedbackOperationsToken],
      modulePath: require.resolve('./feedback_context_step'),
      exportName: 'FeedbackContextStep',
    },
  ],
};

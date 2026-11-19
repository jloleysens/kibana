/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { FeedbackAnalysisContext } from '../../common/http_api/feedback_context';

export type FeedbackContextResult =
  | { outcome: 'success'; context: FeedbackAnalysisContext }
  | { outcome: 'not-found' }
  | { outcome: 'invalid-window'; message: string };

export interface FeedbackOperationsApi {
  isContextEngineEnabled(scopeId: string): Promise<boolean>;
  isFeedbackLoopEnabled(scopeId: string): Promise<boolean>;
  buildContext(scopeId: string, aiIndexId: string): Promise<FeedbackContextResult>;
}

export const FeedbackOperationsToken = createToken<FeedbackOperationsApi>(
  'contextEngine.feedbackOperations'
);
export const WorkflowStepKind = createToken('workflows.step');

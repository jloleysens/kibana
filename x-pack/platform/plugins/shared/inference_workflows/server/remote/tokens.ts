/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { ElasticsearchClient } from '@kbn/core/server';

export { InferenceFeaturesToken } from '@kbn/search-inference-endpoints/server/remote/tokens';
export type { InferenceFeaturesApi } from '@kbn/search-inference-endpoints/server/remote/tokens';
export interface InferenceDataPlane {
  internal(scopeId?: string): ElasticsearchClient;
  user(scopeId: string): ElasticsearchClient;
}
export const WorkflowDataPlaneToken = createToken<InferenceDataPlane>('workflows.dataPlane');
export const WorkflowStepKind = createToken<object>('workflows.step');

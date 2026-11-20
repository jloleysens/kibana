/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { SearchInferenceEndpointsPluginStart } from '../types';

export interface InferenceFeaturesApi {
  list(
    scopeId: string
  ): Promise<ReturnType<SearchInferenceEndpointsPluginStart['features']['getAll']>>;
  getForFeature(
    scopeId: string,
    featureId: string,
    options?: Parameters<SearchInferenceEndpointsPluginStart['endpoints']['getForFeature']>[2]
  ): ReturnType<SearchInferenceEndpointsPluginStart['endpoints']['getForFeature']>;
}
export const InferenceFeaturesToken = createToken<InferenceFeaturesApi>('inference.features');

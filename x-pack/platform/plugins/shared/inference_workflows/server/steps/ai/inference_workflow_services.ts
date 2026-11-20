/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { InferenceServerStart } from '@kbn/inference-plugin/server';
import type { SearchInferenceEndpointsPluginStart } from '@kbn/search-inference-endpoints/server';

export type WorkflowInference = Pick<
  InferenceServerStart,
  'getClient' | 'getChatModel' | 'getConnectorById' | 'getConnectorList' | 'getDefaultConnector'
>;
export interface InferenceWorkflowServices {
  readonly parseMaxStepSize: (value: string | undefined) => number | undefined;
  readonly inference: WorkflowInference;
  readonly searchInferenceEndpoints: {
    readonly features: Pick<SearchInferenceEndpointsPluginStart['features'], 'get'>;
    readonly endpoints: Pick<SearchInferenceEndpointsPluginStart['endpoints'], 'getForFeature'>;
  };
}

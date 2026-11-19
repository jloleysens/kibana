/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { executeLegacyInferenceAction as ownedBridge } from '@kbn/stack-connectors-plugin/server/remote/execute_inference_action';
import { InferenceFeatures as ownedFeatures } from '@kbn/search-inference-endpoints/server/remote/inference_features';
import { InferenceFeaturesToken as ownedToken } from '@kbn/search-inference-endpoints/server/remote/tokens';
import { executeLegacyInferenceAction } from './execute_legacy_action';
import { InferenceFeatures } from './inference_features';
import { InferenceFeaturesToken } from './tokens';

it('preserves original bridge, scoped feature capability and token identities at their old paths', () => {
  expect(executeLegacyInferenceAction).toBe(ownedBridge);
  expect(InferenceFeatures).toBe(ownedFeatures);
  expect(InferenceFeaturesToken).toBe(ownedToken);
});

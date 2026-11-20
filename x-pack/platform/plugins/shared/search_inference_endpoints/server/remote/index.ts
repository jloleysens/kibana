/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RemoteModule } from '@kbn/core-remote-common';
import { InferenceFeaturesToken } from './tokens';
export const remoteModule: RemoteModule = {
  providers: [
    {
      token: InferenceFeaturesToken,
      placement: 'coordinator',
      modulePath: require.resolve('./inference_features'),
      exportName: 'InferenceFeatures',
    },
  ],
};

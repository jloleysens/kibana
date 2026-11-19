/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RemoteModule } from '@kbn/core-remote-common';
import { InferencePolicyToken } from '@kbn/inference-plugin/server/remote/tokens';
import { InferenceFeaturesToken, WorkflowStepKind } from './tokens';

export const remoteModule: RemoteModule = {
  providers: [
    {
      token: InferencePolicyToken,
      placement: 'coordinator',
      modulePath: require.resolve('@kbn/inference-plugin/server/remote/inference_policy'),
      exportName: 'InferencePolicyCapability',
    },
    {
      token: InferenceFeaturesToken,
      placement: 'coordinator',
      modulePath: require.resolve('./inference_features'),
      exportName: 'InferenceFeatures',
    },
  ],
  contributions: [
    {
      kind: WorkflowStepKind,
      stepType: 'ai.prompt',
      modulePath: require.resolve('./ai_prompt_step'),
      exportName: 'AiPromptStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'ai.summarize',
      modulePath: require.resolve('./ai_summarize_step'),
      exportName: 'AiSummarizeStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'ai.classify',
      modulePath: require.resolve('./ai_classify_step'),
      exportName: 'AiClassifyStep',
    },
  ],
};

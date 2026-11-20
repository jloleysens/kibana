/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RemoteModule } from '@kbn/core-remote-common';
import { InferencePolicyToken } from '@kbn/inference-plugin/server/remote/tokens';
import { InferenceFeaturesToken } from '@kbn/search-inference-endpoints/server/remote/tokens';
import { SpecRuntimeToken } from '@kbn/actions-plugin/server/remote/tokens';
import { WorkflowStepKind, WorkflowDataPlaneToken } from './tokens';

export const remoteModule: RemoteModule = {
  contributions: [
    {
      kind: WorkflowStepKind,
      needs: [
        InferencePolicyToken,
        InferenceFeaturesToken,
        WorkflowDataPlaneToken,
        SpecRuntimeToken,
      ],
      stepType: 'ai.prompt',
      modulePath: require.resolve('./ai_prompt_step'),
      exportName: 'AiPromptStep',
    },
    {
      kind: WorkflowStepKind,
      needs: [
        InferencePolicyToken,
        InferenceFeaturesToken,
        WorkflowDataPlaneToken,
        SpecRuntimeToken,
      ],
      stepType: 'ai.summarize',
      modulePath: require.resolve('./ai_summarize_step'),
      exportName: 'AiSummarizeStep',
    },
    {
      kind: WorkflowStepKind,
      needs: [
        InferencePolicyToken,
        InferenceFeaturesToken,
        WorkflowDataPlaneToken,
        SpecRuntimeToken,
      ],
      stepType: 'ai.classify',
      modulePath: require.resolve('./ai_classify_step'),
      exportName: 'AiClassifyStep',
    },
  ],
};

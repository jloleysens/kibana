/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import {
  InferencePolicyToken,
  type InferencePolicyApi,
} from '@kbn/inference-plugin/server/remote/tokens';
import {
  InferenceFeaturesToken,
  WorkflowDataPlaneToken,
  type InferenceFeaturesApi,
  type InferenceDataPlane,
} from './tokens';
import { runInferenceStep } from './run_inference_step';
import { createAiSummarizeHandler } from '../steps/ai/ai_summarize_step/handler';

export class AiSummarizeStep implements RemoteWorkflowStep {
  constructor(
    @inject(InferencePolicyToken) private readonly policyApi: InferencePolicyApi,
    @inject(InferenceFeaturesToken) private readonly featuresApi: InferenceFeaturesApi,
    @inject(WorkflowDataPlaneToken) private readonly data: InferenceDataPlane
  ) {}

  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [scopeId, , context] = args;
    return runInferenceStep({
      scopeId,
      context,
      policyApi: this.policyApi,
      featuresApi: this.featuresApi,
      data: this.data,
      runHandler: async (services) => {
        const handler = createAiSummarizeHandler(async () => services);
        return handler(context.handlerContext as Parameters<typeof handler>[0]);
      },
    });
  }
}

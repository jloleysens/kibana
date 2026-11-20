/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import { SpecRuntimeToken } from '@kbn/actions-plugin/server/remote/tokens';
import type { SpecRuntime } from '@kbn/actions-plugin/server/remote/spec_runtime';
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
import { createAiPromptHandler } from '../steps/ai/ai_prompt_step/handler';

export class AiPromptStep implements RemoteWorkflowStep {
  constructor(
    @inject(InferencePolicyToken) private readonly policyApi: InferencePolicyApi,
    @inject(InferenceFeaturesToken) private readonly featuresApi: InferenceFeaturesApi,
    @inject(WorkflowDataPlaneToken) private readonly data: InferenceDataPlane,
    @inject(SpecRuntimeToken) private readonly connectors: SpecRuntime
  ) {}

  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [scopeId, , context] = args;
    return runInferenceStep({
      scopeId,
      context,
      policyApi: this.policyApi,
      featuresApi: this.featuresApi,
      data: this.data,
      connectors: this.connectors,
      runHandler: async (services) => {
        const handler = createAiPromptHandler(async () => services);
        return handler(context.handlerContext as Parameters<typeof handler>[0]);
      },
    });
  }
}

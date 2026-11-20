/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import {
  ConversationRegistryToken,
  type ConversationRegistryApi,
} from '@kbn/agent-builder-plugin/server/remote/conversation_tokens';
import {
  InferencePolicyToken,
  type InferencePolicyApi,
} from '@kbn/inference-plugin/server/remote/tokens';
import {
  InferenceFeaturesToken,
  type InferenceFeaturesApi,
} from '@kbn/search-inference-endpoints/server/remote/tokens';
import {
  ConversationDataPlaneToken as WorkflowDataPlaneToken,
  type ConversationDataPlane,
} from '@kbn/agent-builder-plugin/server/remote/conversation_tokens';
import type { ConnectorDataPlane } from '@kbn/stack-connectors-plugin/server/remote/tokens';
import { SpecRuntimeToken } from '@kbn/actions-plugin/server/remote/tokens';
import type { SpecRuntime } from '@kbn/actions-plugin/server/remote/spec_runtime';
import { OptimizerPolicyToken, type OptimizerPolicyApi } from './optimizer_policy_tokens';

import { OptimizerStep } from './optimizer_step';
type RunArgs = Parameters<RemoteWorkflowStep['run']>;
export class CortexOptimizeStep extends OptimizerStep implements RemoteWorkflowStep {
  constructor(
    @inject(OptimizerPolicyToken) policy: OptimizerPolicyApi,
    @inject(ConversationRegistryToken) registry: ConversationRegistryApi,
    @inject(InferencePolicyToken) inferencePolicy: InferencePolicyApi,
    @inject(InferenceFeaturesToken) features: InferenceFeaturesApi,
    @inject(WorkflowDataPlaneToken) data: ConversationDataPlane & ConnectorDataPlane,
    @inject(SpecRuntimeToken) connectors: SpecRuntime
  ) {
    super(policy, registry, inferencePolicy, features, data, connectors);
  }
  async run(...args: RunArgs): ReturnType<RemoteWorkflowStep['run']> {
    return this.optimize('cortex', args);
  }
}

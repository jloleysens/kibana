/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import type { z } from '@kbn/zod/v4';
import type {
  InputSchema,
  ConfigSchema,
  OutputSchema,
} from '../../common/step_types/run_agent_step';

type Input = z.infer<typeof InputSchema>;
type Config = z.infer<typeof ConfigSchema>;
export type RunAgentUsage = NonNullable<z.infer<typeof OutputSchema>['metadata']>['usage'] & {
  cachedTokens: number;
};

export interface WorkflowAgentParams {
  schema: Input['schema'];
  message: Input['message'];
  conversationId: Input['conversation_id'];
  authorName: string | undefined;
  attachments: Input['attachments'];
  metadata: Input['metadata'];
  configurationOverrides: Input['configuration_overrides'];
  approvals: Input['approvals'];
  templateId: string | undefined;
  templateVersion: Input['template_version'];
  templateVariables: Input['template_variables'];
  agentId: string;
  connectorId: string | undefined;
  featureIds: string[];
  createConversation: Config['create-conversation'];
  publicConversation: Config['public-conversation'];
  ephemeral: Config['ephemeral'];
  pluginId: Config['plugin-id'];
  aggregateBy: Config['aggregate-by'];
  productSolution: Config['product-solution'];
  productFeature: Config['product-feature'];
  maxStepSize: string | undefined;
  reasoningLevel: Config['reasoning-level'];
}

export interface WorkflowAgentOutcome {
  result?: {
    message: string;
    structuredOutput?: z.infer<typeof OutputSchema>['structured_output'];
    conversationId?: string;
  };
  usage: RunAgentUsage;
  error?: Error;
}

export type RunAgentOperation = (
  params: WorkflowAgentParams,
  context: {
    request: KibanaRequest;
    abortSignal: AbortSignal;
    workflowExecutionId: string;
    stepId: string;
  }
) => Promise<WorkflowAgentOutcome>;

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { agentBuilderDefaultAgentId } from '@kbn/agent-builder-common';
import { normalizeConnectorFeatureIds } from '@kbn/search-inference-endpoints/server/lib/resolve_connector_id_from_features';
import type { StepHandler } from '@kbn/workflows-extensions/server';
import type {
  InputSchema,
  OutputSchema,
  RunAgentStepConfigSchema,
} from '../../common/step_types/run_agent_step';
import {
  CONNECTOR_OR_INFERENCE_ID_CONFLICT_MESSAGE_WORKFLOW,
  resolveConnectorOrInferenceId,
} from '../../common/resolve_connector_or_inference_id';
import { normalizeOptionalStringParam } from '../../common/normalize_optional_string_param';
import { EPHEMERAL_WITH_CREATE_CONVERSATION_MESSAGE } from '../../common/step_types/run_agent_constraints';
import type { RunAgentOperation, RunAgentUsage } from './run_agent_types';

/** Shares original input normalization and output/error projection across placements. */
export const createRunAgentStepHandler =
  (
    runAgent: RunAgentOperation
  ): StepHandler<typeof InputSchema, typeof OutputSchema, RunAgentStepConfigSchema> =>
  async (context) => {
    // Accumulate token usage outside the try/catch so partial counts are
    // preserved even if the event stream errors mid-execution.
    const usage: RunAgentUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
    };

    try {
      const {
        schema,
        message,
        conversation_id: conversationId,
        author_name: authorNameRaw,
        attachments,
        metadata,
        configuration_overrides: configurationOverrides,
        approvals,
        template_id: templateIdRaw,
        template_version: templateVersionRaw,
        template_variables: templateVariables,
      } = context.input;
      const authorName = normalizeOptionalStringParam(authorNameRaw);

      const {
        'agent-id': agentId,
        'connector-id': connectorIdRaw,
        'inference-id': inferenceIdRaw,
        'connector-id-by-feature': connectorIdByFeatureRaw,
        'create-conversation': createConversation,
        'public-conversation': publicConversation,
        ephemeral,
        'plugin-id': pluginId,
        'aggregate-by': aggregateBy,
        'product-solution': productSolution,
        'product-feature': productFeature,
        'max-step-size': maxStepSize,
        'reasoning-level': reasoningLevel,
      } = context.config;
      // Workflows only validate the config schema's shape, which drops its refinements.
      if (ephemeral && createConversation) {
        throw new Error(EPHEMERAL_WITH_CREATE_CONVERSATION_MESSAGE);
      }

      context.logger.debug('ai.agent step started');
      const request = context.contextManager.getFakeRequest();
      if (!request) {
        throw new Error('No request available in workflow context');
      }

      const effectiveAgentId = (agentId as string | undefined) || agentBuilderDefaultAgentId;
      const effectiveConnectorId = resolveConnectorOrInferenceId(
        { connectorId: connectorIdRaw, inferenceId: inferenceIdRaw },
        CONNECTOR_OR_INFERENCE_ID_CONFLICT_MESSAGE_WORKFLOW
      );

      const outcome = await runAgent(
        {
          schema,
          message,
          conversationId,
          authorName,
          attachments,
          metadata,
          configurationOverrides,
          approvals,
          templateId: normalizeOptionalStringParam(templateIdRaw),
          templateVersion: templateVersionRaw,
          templateVariables,
          agentId: effectiveAgentId,
          connectorId: effectiveConnectorId,
          featureIds: normalizeConnectorFeatureIds(connectorIdByFeatureRaw),
          createConversation,
          publicConversation,
          ephemeral,
          pluginId,
          aggregateBy,
          productSolution,
          productFeature,
          maxStepSize,
          reasoningLevel,
        },
        {
          request,
          abortSignal: context.abortSignal,
          workflowExecutionId: context.contextManager.getContext().execution.id,
          stepId: context.stepId,
        }
      );
      Object.assign(usage, outcome.usage);
      if (outcome.error) throw outcome.error;
      if (!outcome.result) throw new Error('No agent result received');
      const {
        message: outputMessage,
        structuredOutput,
        conversationId: outputConversationId,
      } = outcome.result;
      return {
        output: {
          message: outputMessage,
          structured_output: structuredOutput,
          ...(outputConversationId && { conversation_id: outputConversationId }),
          metadata: { usage },
        },
      };
    } catch (error) {
      context.logger.error(
        'agentBuilder.runAgent step failed',
        error instanceof Error ? error : new Error(String(error))
      );
      return {
        output: { message: '', metadata: { usage } },
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  };

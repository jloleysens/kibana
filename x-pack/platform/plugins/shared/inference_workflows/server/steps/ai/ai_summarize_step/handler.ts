/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { MessageFieldWithRole } from '@langchain/core/messages';
import type { StepHandler } from '@kbn/workflows-extensions/server';
import {
  buildDataPart,
  buildInstructionsPart,
  buildRequirementsPart,
  buildSystemPart,
} from './build_prompts';
import type { AiSummarizeStepCommonDefinition } from '../../../../common/steps/ai';
import type { InferenceWorkflowServices } from '../inference_workflow_services';
import { AI_SUMMARIZE_FEATURE_ID } from '../ai_feature_ids';
import { resolveConnectorId } from '../utils/resolve_connector_id';

export const createAiSummarizeHandler =
  (
    getServices: () => Promise<InferenceWorkflowServices>
  ): StepHandler<
    typeof AiSummarizeStepCommonDefinition.inputSchema,
    typeof AiSummarizeStepCommonDefinition.outputSchema,
    NonNullable<typeof AiSummarizeStepCommonDefinition.configSchema>
  > =>
  async (context) => {
    const { inference, searchInferenceEndpoints } = await getServices();

    const resolvedConnectorId = await resolveConnectorId(
      context.config['connector-id'],
      inference,
      context.contextManager.getFakeRequest(),
      { featureId: AI_SUMMARIZE_FEATURE_ID, searchInferenceEndpoints }
    );

    const chatModel = await inference.getChatModel({
      connectorId: resolvedConnectorId,
      request: context.contextManager.getFakeRequest(),
      chatModelOptions: {
        temperature: context.input.temperature,
        maxRetries: 0,
      },
    });

    const modelInput: MessageFieldWithRole[] = [
      ...buildSystemPart(),
      ...buildDataPart(context.input.input),
      ...buildRequirementsPart({ maxLength: context.input.maxLength }),
      ...buildInstructionsPart(context.input.instructions),
    ];

    const modelResponse = await chatModel.invoke(modelInput, {
      signal: context.abortSignal,
    });

    // Convert content to string if it's an array
    const content =
      typeof modelResponse.content === 'string'
        ? modelResponse.content
        : modelResponse.content.map((part) => ('text' in part ? part.text : '')).join('');

    return {
      output: {
        content,
        metadata: modelResponse.response_metadata,
      },
    };
  };

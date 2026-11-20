/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ByteSizeValue } from '@kbn/config-schema';
import { Validator } from '@cfworker/json-schema';
import {
  createNonInteractiveConfig,
  ConversationAccessControlMode,
  ConversationRoundStatus,
  DEFAULT_CONVERSATION_TITLE,
  normalizeConversationAccessControl,
  isConversationCreatedEvent,
  isConversationUpdatedEvent,
  isRoundCompleteEvent,
  toAutoApprovedApis,
  AgentExecutionMode,
} from '@kbn/agent-builder-common';
import type {
  Conversation,
  ConversationAccessControl,
  ConversationRound,
} from '@kbn/agent-builder-common';
import type { KibanaRequest } from '@kbn/core/server';
import type { ConnectorTelemetryMetadata } from '@kbn/inference-common';
import { isTemplateRequiredConnector, MessageRole, parseTemplateJson } from '@kbn/inference-common';
import type { InferenceServerStart } from '@kbn/inference-plugin/server';
import { resolveConnectorIdFromFeatures } from '@kbn/search-inference-endpoints/server';
import { firstValueFrom, tap, toArray } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import type { ServiceManager } from '../services';
import { roundToEvents } from '../services/conversation/client/rounds_to_events';
import { buildExecutionTelemetryMetadata } from '../services/execution/utils/build_execution_telemetry_metadata';
import { CONNECTOR_ID_BY_FEATURE_CONFLICT_MESSAGE_WORKFLOW } from '../../common/resolve_connector_or_inference_id';
import type { RunAgentOperation, RunAgentUsage } from '../remote/run_agent_types';
/**
 * Parses a `max-step-size` value (e.g. `"10mb"`, `"1gb"`, or a raw byte count) into bytes,
 * reusing Kibana's shared `ByteSizeValue` parser for consistency with the rest of the platform.
 * Returns `undefined` for empty or malformed values so the caller simply skips the override.
 */
export const parseMaxStepSize = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return ByteSizeValue.parse(trimmed).getValueInBytes();
  } catch {
    return undefined;
  }
};

const assertTemplateMatchesSchema = (value: unknown, schema: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Template response JSON must be an object');
  }
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('Output schema must be a JSON schema object');
  }

  const { valid, errors } = new Validator(
    schema as Record<string, unknown>,
    '2020-12',
    false
  ).validate(value);
  if (!valid) {
    throw new Error(
      `Template response does not match the output schema: ${errors
        .map((error) => error.error)
        .join('; ')}`
    );
  }

  return value as Record<string, unknown>;
};

/**
 * When the connector requires an EIS template, call chat completion directly.
 * Returns undefined so the caller keeps the agent path.
 */
const completeWithPromptTemplate = async ({
  inference,
  request,
  connectorId,
  templateId,
  templateVersion,
  templateVariables,
  schema,
  abortSignal,
  connectorTelemetry,
}: {
  inference: InferenceServerStart | undefined;
  request: KibanaRequest;
  connectorId: string | undefined;
  templateId: string | undefined;
  templateVersion: number | undefined;
  templateVariables: Record<string, unknown>;
  schema: unknown;
  abortSignal?: AbortSignal;
  connectorTelemetry?: ConnectorTelemetryMetadata;
}): Promise<
  | {
      message: string;
      structuredOutput: unknown;
      elapsedMs: number;
      usage: {
        connectorId?: string;
        inputTokens: number;
        outputTokens: number;
        cachedTokens: number;
        totalTokens: number;
      };
    }
  | undefined
> => {
  if (!inference) {
    if (templateId && connectorId) {
      throw new Error('Inference is not available, so the prompt template cannot be sent');
    }
    return undefined;
  }

  // A messages call does not need the connector list. A template-only connector
  // with no template fields fails at the gateway.
  if (!templateId) {
    return undefined;
  }

  // A step with no connector uses the default GenAI connector. Resolve it before deciding
  // whether the template fields apply, so a messages connector ignores them.
  let resolvedConnectorId = connectorId;
  if (!resolvedConnectorId) {
    resolvedConnectorId = (await inference.getDefaultConnector(request))?.connectorId;
    if (!resolvedConnectorId) {
      return undefined;
    }
  }

  const client = inference.getClient({ request });
  let templateRequired = false;
  try {
    const connector = await client.getConnectorById(resolvedConnectorId);
    templateRequired = isTemplateRequiredConnector(connector);
  } catch (error) {
    if (templateId) {
      throw error;
    }
    return undefined;
  }

  if (!templateRequired) {
    return undefined;
  }

  if (templateVersion == null) {
    throw new Error(
      `Connector "${resolvedConnectorId}" requires a prompt template and cannot be called with messages`
    );
  }

  const startedAt = Date.now();
  const response = await client.chatComplete({
    connectorId: resolvedConnectorId,
    stream: false,
    messages: [{ role: MessageRole.User, content: '' }],
    template: { id: templateId, version: templateVersion, variables: templateVariables },
    abortSignal,
    ...(connectorTelemetry ? { metadata: { connectorTelemetry } } : {}),
  });

  const structuredOutput = schema
    ? assertTemplateMatchesSchema(parseTemplateJson(response.content ?? ''), schema)
    : undefined;
  const promptTokens = response.tokens?.prompt ?? 0;
  const completionTokens = response.tokens?.completion ?? 0;

  return {
    message: schema ? JSON.stringify(structuredOutput) : response.content ?? '',
    structuredOutput,
    elapsedMs: Date.now() - startedAt,
    usage: {
      connectorId: resolvedConnectorId,
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      cachedTokens: response.tokens?.cached ?? 0,
      totalTokens: response.tokens?.total ?? promptTokens + completionTokens,
    },
  };
};

const storeTemplateConversation = async ({
  serviceManager,
  request,
  agentId,
  conversationId,
  createConversation,
  accessControl,
  message,
  responseMessage,
  structuredOutput,
  usage,
  elapsedMs,
}: {
  serviceManager: ServiceManager;
  request: KibanaRequest;
  agentId: string;
  conversationId: string | undefined;
  createConversation: boolean | undefined;
  accessControl: Pick<ConversationAccessControl, 'access_mode'> | undefined;
  message: string;
  responseMessage: string;
  structuredOutput: unknown;
  usage: { connectorId?: string; inputTokens: number; outputTokens: number; cachedTokens: number };
  elapsedMs: number;
}): Promise<string> => {
  const conversations = serviceManager.internalStart?.conversations;
  if (!conversations) {
    throw new Error(
      'Conversation service is not available, so the template result cannot be stored'
    );
  }

  const client = await conversations.getScopedClient({ request });
  const existing =
    conversationId && !createConversation ? await client.get(conversationId) : undefined;
  const conversation: Conversation =
    existing ??
    (await client.create(
      {
        agent_id: agentId,
        ...(conversationId ? { id: conversationId } : {}),
        title: DEFAULT_CONVERSATION_TITLE,
        rounds: [],
        ...(accessControl
          ? { access_control: normalizeConversationAccessControl(accessControl) }
          : {}),
      },
      { source: 'workflow' }
    ));

  const round: ConversationRound = {
    id: uuidv4(),
    status: ConversationRoundStatus.completed,
    input: { message },
    steps: [],
    response: {
      message: responseMessage,
      ...(structuredOutput && typeof structuredOutput === 'object'
        ? { structured_output: structuredOutput as object }
        : {}),
    },
    started_at: new Date().toISOString(),
    time_to_first_token: elapsedMs,
    time_to_last_token: elapsedMs,
    model_usage: {
      connector_id: usage.connectorId ?? '',
      llm_calls: 1,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cached_input_tokens: usage.cachedTokens,
    },
  };

  await client.appendEvents(
    { id: conversation.id, events: roundToEvents(round, conversation) },
    { source: 'workflow' }
  );

  return conversation.id;
};

/** Runs the original scoped agent/template services without a workflow handler context. */
export const createWorkflowAgentRunner =
  (serviceManager: ServiceManager): RunAgentOperation =>
  async (params, { request, abortSignal, workflowExecutionId }) => {
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
        conversationId,
        authorName,
        attachments,
        metadata,
        configurationOverrides,
        approvals,
        templateId,
        templateVersion,
        templateVariables,
        agentId: effectiveAgentId,
        connectorId,
        featureIds,
        createConversation,
        publicConversation,
        ephemeral,
        pluginId,
        aggregateBy,
        productSolution,
        productFeature,
        maxStepSize,
        reasoningLevel,
      } = params;
      const maxContentLength =
        typeof maxStepSize === 'string' ? parseMaxStepSize(maxStepSize) : undefined;
      let effectiveConnectorId = connectorId;
      if (featureIds.length > 0) {
        const { searchInferenceEndpoints } = serviceManager.internalStart ?? {};
        if (!searchInferenceEndpoints) {
          throw new Error('searchInferenceEndpoints service is not available');
        }
        const connectorIdFromFeatures = await resolveConnectorIdFromFeatures({
          featureIds,
          request,
          searchInferenceEndpoints,
          hasExplicitConnector: effectiveConnectorId !== undefined,
          conflictMessage: CONNECTOR_ID_BY_FEATURE_CONFLICT_MESSAGE_WORKFLOW,
        });
        if (connectorIdFromFeatures) {
          effectiveConnectorId = connectorIdFromFeatures;
        }
      }

      const storeConversation = !ephemeral && (createConversation || Boolean(conversationId));
      const accessControl = publicConversation
        ? { access_mode: ConversationAccessControlMode.Public }
        : undefined;
      const connectorTelemetry = buildExecutionTelemetryMetadata({
        telemetryMetadata: pluginId
          ? { pluginId, aggregateBy, productSolution, productFeature }
          : undefined,
        workflowExecutionId,
      });

      const templateResult = await completeWithPromptTemplate({
        inference: serviceManager.internalStart?.inference,
        request,
        connectorId: effectiveConnectorId,
        templateId,
        templateVersion,
        templateVariables: templateVariables ?? {},
        schema,
        abortSignal,
        connectorTelemetry,
      });
      if (templateResult) {
        const outputConversationId = storeConversation
          ? await storeTemplateConversation({
              serviceManager,
              request,
              agentId: effectiveAgentId,
              conversationId,
              createConversation,
              accessControl,
              message: message ?? '',
              responseMessage: templateResult.message,
              structuredOutput: templateResult.structuredOutput,
              usage: templateResult.usage,
              elapsedMs: templateResult.elapsedMs,
            })
          : undefined;

        return {
          result: {
            message: templateResult.message,
            structuredOutput: templateResult.structuredOutput,
            conversationId: outputConversationId,
          },
          usage: { ...usage, ...templateResult.usage },
        };
      }

      const executionService = serviceManager.internalStart?.execution;
      if (!executionService) {
        throw new Error('execution service is not available');
      }

      const { events$ } = await executionService.executeAgent({
        mode: AgentExecutionMode.conversation,
        request,
        abortSignal,
        metadata,
        interactive: createNonInteractiveConfig(
          approvals?.auto_approved_apis && toAutoApprovedApis(approvals.auto_approved_apis)
        ),
        params: {
          agentId: effectiveAgentId,
          connectorId: effectiveConnectorId,
          conversationId,
          ...(authorName ? { author: { full_name: authorName } } : {}),
          autoCreateConversationWithId: createConversation,
          storeConversation,
          accessControl,
          structuredOutput: !!schema,
          outputSchema: schema,
          configurationOverrides,
          nextInput: {
            message,
            attachments,
          },
          ...(maxContentLength !== undefined ? { maxContentLength } : {}),
          ...(reasoningLevel !== undefined ? { reasoningLevel } : {}),
          // The single source of the workflow run: the execution reports it on its round events
          // and sends it to EIS as `interactionId`, with or without a `plugin-id`.
          workflowExecutionId,
          ...(pluginId
            ? {
                telemetryMetadata: {
                  pluginId,
                  aggregateBy,
                  productSolution,
                  productFeature,
                },
              }
            : {}),
        },
        // workflows already run as scheduled tasks
        useTaskManager: false,
      });

      const events = await firstValueFrom(
        events$.pipe(
          tap((event) => {
            if (isRoundCompleteEvent(event)) {
              const { model_usage: modelUsage } = event.data.round;
              if (modelUsage) {
                // 'unknown' is the sentinel for a round that made no LLM call
                // (see add_round_complete_event.ts). A step uses one connector
                // today, so the last real value is the step's connector.
                if (modelUsage.connector_id && modelUsage.connector_id !== 'unknown') {
                  usage.connectorId = modelUsage.connector_id;
                }
                usage.inputTokens += modelUsage.input_tokens;
                usage.outputTokens += modelUsage.output_tokens;
                usage.cachedTokens += modelUsage.cached_input_tokens ?? 0;
                usage.totalTokens += modelUsage.input_tokens + modelUsage.output_tokens;
              }
            }
          }),
          toArray()
        )
      );

      const roundEvent = events.find(isRoundCompleteEvent);
      if (!roundEvent) {
        throw new Error('No round_complete event received from execution service');
      }

      const round = roundEvent.data.round;
      const outputMessage = schema
        ? JSON.stringify(round.response.structured_output)
        : round.response.message;

      let outputConversationId: string | undefined;
      if (storeConversation) {
        const conversationEvent = events.find(
          (e) => isConversationCreatedEvent(e) || isConversationUpdatedEvent(e)
        );
        if (!conversationEvent) {
          throw new Error('No conversation_created / conversation_updated event received');
        }
        outputConversationId = conversationEvent.data.conversation_id;
      }

      return {
        result: {
          message: outputMessage,
          structuredOutput: round.response.structured_output,
          conversationId: outputConversationId,
        },
        usage,
      };
    } catch (error) {
      return { usage, error: error instanceof Error ? error : new Error(String(error)) };
    }
  };

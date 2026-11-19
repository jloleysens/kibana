/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SpecRuntime } from '@kbn/actions-plugin/server/remote/spec_runtime';
import type { LocalConnectorExecution } from '@kbn/actions-plugin/server/remote/local_execution';
import type { ActionsClientProvider } from '@kbn/inference-plugin/server/types';
import type { InferenceDataPlane } from './tokens';

type ExecuteAction = Awaited<
  ReturnType<ActionsClientProvider['getActionsClientWithRequest']>
>['execute'];

/** Selects the original lazy connector contribution without moving LLM execution onto the coordinator. */
export const executeLegacyInferenceAction = async ({
  options,
  runtime,
  data,
  scopeId,
  signal,
}: {
  options: Parameters<ExecuteAction>[0];
  runtime: SpecRuntime;
  data: InferenceDataPlane;
  scopeId: string;
  signal: AbortSignal;
}): Promise<LocalConnectorExecution> => {
  // The original resolver selects an authorized descriptor, never exports connector secrets.
  // Prepare resolves the referenced connector again using the original run's request.
  const type = options.params.subAction;
  const connectorType =
    type === 'converse' || type === 'converseStream'
      ? '.bedrock'
      : type === 'invokeStream' || type === 'invokeAIRaw'
      ? '.gemini'
      : type === 'unified_completion_stream'
      ? '.inference'
      : type === 'stream'
      ? '.gen-ai'
      : undefined;
  if (!connectorType) throw new Error(`Unsupported native inference subaction: ${type}`);
  const input = {
    connectorType,
    connectorNameOrId: options.actionId,
    system: false,
    input: {
      ...options.params,
      subActionParams: {
        ...(options.params.subActionParams as object),
        signal: undefined,
      },
    },
  };
  const Constructor =
    connectorType === '.gen-ai'
      ? (await import('@kbn/stack-connectors-plugin/server/remote/openai')).OpenAIConnector
      : connectorType === '.bedrock'
      ? (await import('@kbn/stack-connectors-plugin/server/remote/bedrock')).BedrockConnector
      : connectorType === '.gemini'
      ? (await import('@kbn/stack-connectors-plugin/server/remote/gemini')).GeminiConnector
      : (await import('@kbn/stack-connectors-plugin/server/remote/inference')).InferenceConnector;
  return new Constructor(runtime, data).runLocal(scopeId, input, { signal });
};

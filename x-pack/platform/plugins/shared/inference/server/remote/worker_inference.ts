/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { recordRemoteHeap, recordRemoteTiming } from '@kbn/core-remote-common';
import type { ElasticsearchClient, KibanaRequest, Logger } from '@kbn/core/server';
import type { BoundInferenceClient } from '@kbn/inference-common';
import {
  GEN_AI_SETTINGS_DEFAULT_AI_CONNECTOR,
  GEN_AI_SETTINGS_DEFAULT_AI_CONNECTOR_DEFAULT_ONLY,
} from '@kbn/management-settings-ids';
import type {
  ActionsClientProvider,
  InferenceClientCreateOptions,
  InferenceBoundClientCreateOptions,
  InferenceServerClient,
  InferenceServerStart,
} from '../types';
import type { InferencePolicy, InferencePolicyApi } from './tokens';
import { createClient } from '../inference_client/create_client';
import { createChatModel } from '../inference_client/create_chat_model';
import { getConnectorList } from '../util/get_connector_list';
import { getConnectorById } from '../util/get_connector_by_id';
import { loadDefaultConnector } from '../util/load_default_connector';
import { InferenceEndpointIdCache } from '../util/inference_endpoint_id_cache';
import { shouldStreamInferenceEndpoint } from '../util/should_stream_inference_endpoint';
import { TokenUsageLogger } from '../token_usage/token_usage_logger';

export class UncarvedInferenceBacking extends Error {}

/** Reuses the original inference factories with a fresh, scoped, key-free policy snapshot. */
export const createWorkerInference = ({
  scopeId,
  policy,
  capability,
  internalClient,
  userClient,
  logger,
  executeAction,
}: {
  scopeId: string;
  policy: InferencePolicy;
  capability: InferencePolicyApi;
  internalClient: ElasticsearchClient;
  userClient: ElasticsearchClient;
  logger: Logger;
  executeAction?: Awaited<
    ReturnType<ActionsClientProvider['getActionsClientWithRequest']>
  >['execute'];
}) => {
  const actions = {
    getActionsClientWithRequest: async () => ({
      getAll: async () => {
        if ('error' in policy.stackConnectors) throw new Error(policy.stackConnectors.error);
        return policy.stackConnectors;
      },
      execute:
        executeAction ??
        (async (): Promise<never> => {
          throw new UncarvedInferenceBacking(
            'Legacy inference connector execution is not carved out'
          );
        }),
    }),
  };
  const connectorOptions = { actions, esClient: internalClient, logger };
  const getById = (connectorId: string, request: KibanaRequest) =>
    getConnectorById({ ...connectorOptions, connectorId, request });
  const getDefault = (request: KibanaRequest) =>
    loadDefaultConnector({
      ...connectorOptions,
      request,
      uiSettingsClient: {
        get: async <T>(key: string): Promise<T> => {
          if (key === GEN_AI_SETTINGS_DEFAULT_AI_CONNECTOR) return policy.defaultConnector as T;
          if (key === GEN_AI_SETTINGS_DEFAULT_AI_CONNECTOR_DEFAULT_ONLY)
            return policy.defaultOnly as T;
          throw new Error(`Unexpected inference policy setting: ${key}`);
        },
      },
    });
  const tokenUsageLogger = new TokenUsageLogger(logger);
  tokenUsageLogger.setEsClient(internalClient);
  const options = (request: KibanaRequest) => ({
    request,
    actions,
    logger,
    namespace: policy.namespace,
    anonymizationRulesPromise: Promise.resolve(policy.rules),
    regexWorker: {
      isEnabled: () => policy.regexWorkerEnabled,
      run: (payload: Parameters<InferencePolicyApi['runRegexRules']>[1]) =>
        capability.runRegexRules(scopeId, payload),
    },
    esClient: userClient,
    endpointIdCache: new InferenceEndpointIdCache({ esClient: internalClient }),
    tokenUsageLogger,
    anonymization: {
      onFailurePromise: Promise.resolve(policy.onFailure),
      replacements: { usePersistentReplacements: false },
    },
    isTokenUsageTrackingEnabled: async () => policy.tokenUsageTracking,
    isDefaultConnectorOnly: async () => policy.defaultOnly,
    getDefaultConnectorId: async () => (await getDefault(request))?.connectorId,
    resolveConnectorId: async (id: string) => (await getById(id, request)).connectorId,
    shouldStreamInferenceEndpoint: (service?: string) =>
      shouldStreamInferenceEndpoint({
        service,
        esClient: internalClient,
        logger,
        isStreamingEnabled: async () => policy.streaming,
      }),
  });
  return {
    getConnectorById: getById,
    getConnectorList: (request: KibanaRequest) =>
      getConnectorList({ ...connectorOptions, request }),
    getDefaultConnector: getDefault,
    getClient: <T extends InferenceClientCreateOptions>(input: T) =>
      createClient({
        ...input,
        ...options(input.request),
      }) as T extends InferenceBoundClientCreateOptions
        ? BoundInferenceClient
        : InferenceServerClient,
    getChatModel: async (input: Parameters<InferenceServerStart['getChatModel']>[0]) => {
      const connector = await getById(input.connectorId, input.request);
      if (!connector.isInferenceEndpoint && !executeAction)
        throw new UncarvedInferenceBacking(
          'Legacy inference connector execution is not carved out'
        );
      const model = await createChatModel({ ...input, ...options(input.request) });
      const invoke = model.invoke.bind(model);
      model.invoke = async (...args) => {
        const started = performance.now();
        recordRemoteHeap('INFERENCE_EXECUTION_BEFORE', scopeId);
        try {
          return await invoke(...args);
        } finally {
          recordRemoteHeap('INFERENCE_EXECUTION_AFTER', scopeId);
          recordRemoteTiming('inference_execution', {
            scopeId,
            durationMs: performance.now() - started,
          });
        }
      };
      return model;
    },
  };
};

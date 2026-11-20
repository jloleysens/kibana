/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import { recordRemoteHeap, recordRemoteTiming } from '@kbn/core-remote-common';
import type {
  RemoteWorkflowStep,
  ServerHandlerStepDefinition,
} from '@kbn/workflows-extensions/server';
import type { ConversationAgentStepDeps } from '../workflows/registry';
import type { ConversationRegistryApi, ConversationDataPlane } from './conversation_tokens';

/** Reaches the original conversation handler using the original worker-local client and registry lease. */
export const runConversationStep = async ({
  scopeId,
  context,
  registry,
  data,
  factory,
}: {
  scopeId: string;
  context: Parameters<RemoteWorkflowStep['run']>[2];
  registry: ConversationRegistryApi;
  data: ConversationDataPlane;
  factory: (services: ConversationAgentStepDeps) => Pick<ServerHandlerStepDefinition, 'handler'>;
}): Promise<object> => {
  const handlerContext = context.handlerContext;
  if (!handlerContext) throw new Error('Conversation step requires executor-local handler context');
  handlerContext.abortSignal.throwIfAborted();
  const logger: Logger = {
    get: () => logger,
    log: (record) => handlerContext.logger.debug(String(record.message)),
    trace: (message) => handlerContext.logger.debug(String(message)),
    debug: (message) => handlerContext.logger.debug(String(message)),
    info: (message) => handlerContext.logger.info(String(message)),
    warn: (message) => handlerContext.logger.warn(String(message)),
    error: (message) => handlerContext.logger.error(String(message)),
    fatal: (message) => handlerContext.logger.error(String(message)),
    isLevelEnabled: () => true,
  };
  const started = performance.now();
  recordRemoteHeap('CONVERSATION_SERVICE_BEFORE', scopeId);
  const { createNativeConversation } = await import('./native_conversation');
  const native = await createNativeConversation({
    registry,
    scopeId,
    esClient: data.internal(scopeId),
    logger,
  });
  recordRemoteHeap('CONVERSATION_SERVICE_AFTER', scopeId);
  recordRemoteTiming('conversation_service_first_use', {
    scopeId,
    durationMs: performance.now() - started,
  });
  try {
    const definition = factory({
      getConversationClient: async () => native.client,
      getAgentRegistry: async () => native.agentRegistry,
    });
    return await definition.handler(handlerContext);
  } finally {
    await native.drain();
  }
};

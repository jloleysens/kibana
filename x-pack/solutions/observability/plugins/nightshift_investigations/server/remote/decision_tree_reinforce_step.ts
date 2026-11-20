/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import type { Logger } from '@kbn/core/server';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { ExecutionError } from '@kbn/workflows-runtime';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import {
  ConversationRegistryToken,
  ConversationDataPlaneToken,
  type ConversationRegistryApi,
  type ConversationDataPlane,
} from '@kbn/agent-builder-plugin/server/remote/conversation_tokens';
import type { createNativeConversation } from '@kbn/agent-builder-plugin/server/remote/native_conversation';
import { loadInvestigationRound } from '../investigation_round/round_loader';
import { createDecisionTreeReinforceHandler } from './decision_tree_reinforce';
import { ReinforcementToken, type ReinforcementApi } from './reinforcement_tokens';
import { restoreReinforcementError } from './reinforcement_errors';

export class DecisionTreeReinforceStep implements RemoteWorkflowStep {
  constructor(
    @inject(ReinforcementToken) private readonly reinforcement: ReinforcementApi,
    @inject(ConversationRegistryToken) private readonly registry: ConversationRegistryApi,
    @inject(ConversationDataPlaneToken) private readonly data: ConversationDataPlane
  ) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext)
      throw new Error('Decision tree reinforcement requires executor-local handler context');
    handlerContext.abortSignal.throwIfAborted();
    const policy = await restoreReinforcementError(this.reinforcement.read(scopeId));
    let native: Promise<Awaited<ReturnType<typeof createNativeConversation>>> | undefined;
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
    const handler = createDecisionTreeReinforceHandler({
      isEnabled: () => policy.enabled,
      getServices: async () =>
        !policy.available
          ? undefined
          : {
              loadRound: (options) =>
                loadInvestigationRound({
                  ...options,
                  getConversationClient: async () => {
                    native ??= import(
                      '@kbn/agent-builder-plugin/server/remote/native_conversation'
                    ).then(({ createNativeConversation: create }) =>
                      create({
                        scopeId,
                        registry: this.registry,
                        esClient: this.data.internal(scopeId),
                        logger,
                      })
                    );
                    return (await native).client;
                  },
                }),
              runAgent: async ({ defaultConnectorId, agentParams }) => {
                const reference = await restoreReinforcementError(
                  this.reinforcement.begin(scopeId, handlerContext.stepId, {
                    defaultConnectorId,
                    conversation: agentParams.conversation,
                    message: agentParams.nextInput.message,
                    includeLearningTools: Boolean(agentParams.configurationOverrides),
                  })
                );
                const onAbort = () => {
                  void this.reinforcement.cancel(scopeId, reference).catch((error) => {
                    handlerContext.logger.debug(
                      'Reinforcement cancellation raced scope cleanup',
                      error
                    );
                  });
                };
                handlerContext.abortSignal.addEventListener('abort', onAbort, { once: true });
                if (handlerContext.abortSignal.aborted) onAbort();
                try {
                  const result = await restoreReinforcementError(
                    this.reinforcement.take(scopeId, reference)
                  );
                  if (result.sizeError) throw new ExecutionError(result.sizeError);
                  if (result.error) await restoreReinforcementError(Promise.reject(result.error));
                  return result.message ?? '';
                } finally {
                  handlerContext.abortSignal.removeEventListener('abort', onAbort);
                }
              },
            },
    });
    recordRemoteTiming('nightshift_native_handler', {
      scopeId,
      stepType: 'decision_tree_reinforce',
    });
    try {
      return await handler(handlerContext as Parameters<typeof handler>[0]);
    } finally {
      if (native) await (await native).drain();
    }
  }
}

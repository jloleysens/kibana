/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import { addUserMessageStepDefinition } from '../workflows/steps/add_user_message';
import { AgentExecutionToken, type AgentExecutionApi } from './agent_execution_tokens';
import { restoreRegistryError } from './registry_errors';

export class AddUserMessageStep implements RemoteWorkflowStep {
  constructor(@inject(AgentExecutionToken) private readonly execution: AgentExecutionApi) {}

  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext) throw new Error('User message requires executor-local handler context');
    handlerContext.abortSignal.throwIfAborted();
    const definition = addUserMessageStepDefinition({
      getExecutionService: () => ({
        maybeExecuteAgent: async ({ params }) => {
          await restoreRegistryError(
            this.execution.appendUserMessage(
              scopeId,
              params.conversationId,
              params.nextInput.message,
              params.author?.full_name
            )
          );
        },
      }),
    });
    recordRemoteTiming('user_message_native_handler', { scopeId });
    return definition.handler(handlerContext as Parameters<typeof definition.handler>[0]);
  }
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import { ExecutionError } from '@kbn/workflows-runtime';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { createRunAgentStepHandler } from './run_agent_step_handler';
import { WorkflowAgentToken, type WorkflowAgentApi } from './workflow_agent_tokens';
import { restoreRegistryError } from './registry_errors';

export class RunAgentStep implements RemoteWorkflowStep {
  constructor(@inject(WorkflowAgentToken) private readonly agents: WorkflowAgentApi) {}

  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext) throw new Error('Agent requires executor-local handler context');
    handlerContext.abortSignal.throwIfAborted();
    const handler = createRunAgentStepHandler(async (params, { stepId, abortSignal }) => {
      const resultId = await restoreRegistryError(this.agents.runAgent(scopeId, stepId, params));
      const onAbort = () => {
        void this.agents.cancel(scopeId, resultId).catch((error) => {
          handlerContext.logger.debug('Agent cancellation raced result or scope cleanup', error);
        });
      };
      abortSignal.addEventListener('abort', onAbort, { once: true });
      if (abortSignal.aborted) onAbort();
      try {
        const { outcome, sizeError } = await restoreRegistryError(
          this.agents.takeResult(scopeId, resultId)
        );
        if (sizeError) return { usage: outcome.usage, error: new ExecutionError(sizeError) };
        if (outcome.error) {
          try {
            await restoreRegistryError(Promise.reject(outcome.error));
          } catch (error) {
            return {
              usage: outcome.usage,
              error: error instanceof Error ? error : new Error(String(error)),
            };
          }
        }
        return outcome;
      } finally {
        abortSignal.removeEventListener('abort', onAbort);
      }
    });
    return handler(handlerContext as Parameters<typeof handler>[0]);
  }
}

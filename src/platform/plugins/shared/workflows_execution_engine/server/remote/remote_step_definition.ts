/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { randomUUID } from 'node:crypto';
import type {
  DurablePhaseResult,
  PollHandlerContext,
  StepHandlerContext,
} from '@kbn/workflows-extensions/server';
import { ExecutionError } from '@kbn/workflows-runtime';
import type {
  WorkflowStepDescription,
  WorkflowStepInvocation,
  WorkflowStepResult,
  WorkflowStepRunnerApi,
} from './tokens';
import type { RuntimeStepDefinition } from '../step/custom_step_impl/types';
import type { StepExecutionRuntime } from '../workflow_context_manager/step_execution_runtime';

/** Makes runtime-only phase proxies; context and prior outputs remain in workflow storage. */
export const createRemoteStepDefinition = ({
  description,
  runner,
  runtime,
  scopeId,
  flush,
}: {
  description: WorkflowStepDescription;
  runner: WorkflowStepRunnerApi;
  runtime: StepExecutionRuntime;
  scopeId: string;
  flush: () => Promise<void>;
}): RuntimeStepDefinition => {
  const invoke = async (
    phase: WorkflowStepInvocation['phase'],
    context: StepHandlerContext | PollHandlerContext
  ) => {
    // A concurrent persistence flush may already be draining an earlier snapshot.
    await flush();
    await flush();
    if (phase !== 'onCancel') context.abortSignal.throwIfAborted();
    const invocationId = randomUUID();
    const pending = runner.invoke({
      invocationId,
      scopeId,
      phase,
      executionId: runtime.workflowExecution.id,
      spaceId: runtime.workflowExecution.spaceId,
      nodeId: runtime.node.id,
      stackFrames: runtime.scopeStack.stackFrames,
      description,
      now: context.contextManager.getContext().now ?? new Date(),
      aborted: context.abortSignal.aborted,
    });
    const onAbort = () => {
      void runner.cancel(invocationId).catch(() => {
        runtime.stepLogger.logWarn('Remote step cancellation failed');
      });
    };
    context.abortSignal.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await pending;
      return result;
    } finally {
      context.abortSignal.removeEventListener('abort', onAbort);
    }
  };
  const durable = (result: WorkflowStepResult | undefined): DurablePhaseResult => {
    if (!result) return;
    if (result.error) return { error: new ExecutionError(result.error) };
    if (Object.hasOwn(result, 'output')) return { output: result.output };
    return { state: result.state, nextPollDelayMs: result.nextPollDelayMs };
  };
  const common = {
    id: description.type,
    configKeys: description.configKeys,
    ...(description.hasOnCancel
      ? {
          onCancel: async (context: StepHandlerContext | PollHandlerContext) => {
            await invoke('onCancel', context);
          },
        }
      : {}),
  };
  if (description.mode === 'poll') {
    return {
      ...common,
      policy: description.policy,
      ceilings: description.ceilings,
      ...(description.hasStart
        ? { start: async (context: StepHandlerContext) => durable(await invoke('start', context)) }
        : {}),
      poll: async (context: PollHandlerContext) => durable(await invoke('poll', context)),
    };
  }
  return {
    ...common,
    handler: async (context: StepHandlerContext) => {
      const result = await invoke('handler', context);
      if (!result) throw new Error('Coordinator handler returned no result');
      return {
        output: result.output,
        error: result.error ? new ExecutionError(result.error) : undefined,
      };
    },
  };
};

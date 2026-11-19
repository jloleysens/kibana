/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { recordRemoteTiming } from '@kbn/core-remote-common';
import type {
  RemoteWorkflowStep,
  ServerHandlerStepDefinition,
} from '@kbn/workflows-extensions/server';
import type { GetWorkflowCasesClient } from '../workflows/types';
import type { CasesClientOperationsApi } from './client_operations_tokens';
import { createWorkflowCasesClient, restoreCasesErrorName } from './create_workflow_client';

/** Runs the original handler locally; only enumerated authenticated Cases client operations cross. */
export const runCasesStep = async (
  api: CasesClientOperationsApi,
  factory: (
    getClient: GetWorkflowCasesClient
  ) =>
    | Pick<ServerHandlerStepDefinition, 'id' | 'handler'>
    | Promise<Pick<ServerHandlerStepDefinition, 'id' | 'handler'>>,
  ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
): ReturnType<RemoteWorkflowStep['run']> => {
  const { handlerContext } = context;
  if (!handlerContext) throw new Error('Cases requires executor-local handler context');
  handlerContext.abortSignal.throwIfAborted();
  const definition = await restoreCasesErrorName(
    Promise.resolve(
      factory(async (_request, options) =>
        createWorkflowCasesClient(api, scopeId, options?.actionSource)
      )
    )
  );
  if (!('handler' in definition)) throw new Error('Cases requires an ordinary handler');
  recordRemoteTiming('cases_native_handler', {
    scopeId,
    stepType: definition.id,
    executionId: handlerContext.contextManager.getContext().execution.id,
  });
  return definition.handler(handlerContext);
};

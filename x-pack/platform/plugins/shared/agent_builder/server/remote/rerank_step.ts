/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { recordRemoteTiming } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { rerankStepDefinition } from '../step_types/rerank_step';

export class RerankStep implements RemoteWorkflowStep {
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext) throw new Error('Rerank requires executor-local handler context');
    handlerContext.abortSignal.throwIfAborted();
    recordRemoteTiming('rerank_native_handler', { scopeId });
    return rerankStepDefinition.handler(
      handlerContext as Parameters<typeof rerankStepDefinition.handler>[0]
    );
  }
}

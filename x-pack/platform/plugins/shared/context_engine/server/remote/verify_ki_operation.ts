/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { KiOperationsApi } from './ki_tokens';
import type { KiHandlerOperations } from '../step_types/ki_handler_operations';
import { restoreKiError } from './ki_errors';

export const verifyKiForStep = async (
  api: KiOperationsApi,
  scopeId: string,
  context: Pick<StepHandlerContext, 'abortSignal' | 'logger'>,
  params: Parameters<KiHandlerOperations['verifyKi']>[0]
): ReturnType<KiHandlerOperations['verifyKi']> => {
  const reference = await restoreKiError(api.openVerification(scopeId));
  const onAbort = () => {
    void api
      .cancelVerification(scopeId, reference)
      .catch((error: Error) => context.logger.error(error.message));
  };
  context.abortSignal.addEventListener('abort', onAbort, { once: true });
  if (context.abortSignal.aborted) onAbort();
  try {
    return await restoreKiError(api.verify(scopeId, reference, params));
  } finally {
    context.abortSignal.removeEventListener('abort', onAbort);
  }
};

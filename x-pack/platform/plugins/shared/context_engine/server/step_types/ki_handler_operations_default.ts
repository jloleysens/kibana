/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import { putKiRevision } from '../ai_indices/ki_revision';
import { updateKi, softDeleteKi } from '../ai_indices/ki_write';
import type { KiWriteAction } from '../telemetry';
import type { KiHandlerOperations } from './ki_handler_operations';
import type { KiStepDependencies } from './helpers';
import type { VerifyKi } from './verify_ki';
import {
  assertContextEngineEnabled,
  assertKiWritePrivilege,
  kiWriterFromContext,
  resolveAiIndex,
  resolveOrCreateAiIndex,
  withKiWriteTelemetry,
} from './helpers';

export const createDefaultKiHandlerOperations = (
  context: Pick<StepHandlerContext, 'contextManager' | 'abortSignal'>,
  dependencies: KiStepDependencies & { verifyKi?: VerifyKi },
  action: KiWriteAction
): KiHandlerOperations => {
  const {
    getAiIndexService,
    isContextEngineEnabled,
    checkWritePrivilege,
    analyticsService,
    logger,
  } = dependencies;
  const request = context.contextManager.getFakeRequest();
  const spaceId = context.contextManager.getContext().workflow.spaceId;
  return {
    assertEnabled: () => assertContextEngineEnabled(isContextEngineEnabled, spaceId),
    checkWritePrivilege: () => assertKiWritePrivilege(checkWritePrivilege, request, spaceId),
    resolve: (aiIndexId) =>
      (action === 'create' ? resolveOrCreateAiIndex : resolveAiIndex)(
        getAiIndexService,
        aiIndexId,
        spaceId
      ),
    withTelemetry: (aiIndexId, run) =>
      withKiWriteTelemetry({ action, aiIndexId, analyticsService, logger, run }),
    verifyKi: (params) => {
      if (!dependencies.verifyKi) throw new Error('KI verifier unavailable');
      return dependencies.verifyKi({ ...params, context });
    },
    put: ({ document, ...options }) => {
      const writer = kiWriterFromContext(context.contextManager.getContext());
      return putKiRevision({
        esClient: context.contextManager.getScopedEsClient(),
        ...options,
        document: {
          ...document,
          governance: {
            provenance: { created_by: writer, updated_by: writer },
            ...document.governance,
          },
        },
      });
    },
    update: (options) =>
      updateKi(context.contextManager.getScopedEsClient(), {
        ...options,
        writer: kiWriterFromContext(context.contextManager.getContext()),
      }),
    remove: (options) =>
      softDeleteKi(context.contextManager.getScopedEsClient(), {
        ...options,
        writer: kiWriterFromContext(context.contextManager.getContext()),
      }),
  };
};

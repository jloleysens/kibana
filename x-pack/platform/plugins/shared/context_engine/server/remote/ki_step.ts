/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { recordRemoteTiming } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import {
  updateKiWithRevisionOperations,
  softDeleteKiWithRevisionOperations,
} from '../ai_indices/ki_write_algorithms';
import type { KiRevisionOperations } from '../ai_indices/ki_write_algorithms';
import { createCreateKiHandler } from '../step_types/create_ki_handler';
import { createUpdateKiHandler } from '../step_types/update_ki_handler';
import { createDeleteKiHandler } from '../step_types/delete_ki_handler';
import type { KiHandlerOperations } from '../step_types/ki_handler_operations';
import { errorTypeForTelemetry } from '../telemetry/error_type';
import type { KiOperationsApi } from './ki_tokens';
import { verifyKiForStep } from './verify_ki_operation';
import { restoreKiError } from './ki_errors';

export class KiStep implements RemoteWorkflowStep {
  constructor(
    private readonly api: KiOperationsApi,
    private readonly action: 'create' | 'update' | 'delete'
  ) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext) throw new Error('KI writes require executor-local handler context');
    handlerContext.abortSignal.throwIfAborted();
    let reference: string | undefined;
    const writeReference = (): string => {
      if (!reference) throw new Error('KI write not opened');
      return reference;
    };
    const revisions = new WeakMap<object, string>();
    const operations: KiRevisionOperations = {
      get: async ({ kiId, includeSource }) => {
        const result = await restoreKiError(
          this.api.readRevision(scopeId, writeReference(), kiId, includeSource === true)
        );
        revisions.set(result.revision, result.reference);
        return result.revision;
      },
      write: ({ revision, changes, refresh = false }) => {
        const revisionReference = revisions.get(revision);
        if (!revisionReference) throw new Error('Unknown local KI revision');
        revisions.delete(revision);
        return restoreKiError(
          this.api.writeRevision(scopeId, writeReference(), revisionReference, changes, refresh)
        );
      },
    };
    const dependencies: KiHandlerOperations = {
      assertEnabled: () => restoreKiError(this.api.assertEnabled(scopeId)),
      checkWritePrivilege: () => restoreKiError(this.api.authorizeWrite(scopeId, writeReference())),
      resolve: () => restoreKiError(this.api.resolve(scopeId, writeReference())),
      withTelemetry: async (aiIndexId, run) => {
        reference = await restoreKiError(
          this.api.openWrite(scopeId, handlerContext.stepId, aiIndexId)
        );
        const openedReference = reference;
        const onAbort = () => {
          void this.api
            .cancelWrite(scopeId, openedReference)
            .catch((error: Error) => handlerContext.logger.error(error.message));
        };
        handlerContext.abortSignal.addEventListener('abort', onAbort, { once: true });
        if (handlerContext.abortSignal.aborted) onAbort();
        try {
          const result = await run(() => {});
          const completedReference = writeReference();
          reference = undefined;
          await restoreKiError(
            this.api.finishWrite(scopeId, completedReference, { id: result.output.id })
          );
          return result;
        } catch (error) {
          if (reference && !handlerContext.abortSignal.aborted) {
            await restoreKiError(
              this.api.finishWrite(scopeId, reference, {
                error: {
                  message: error instanceof Error ? error.message : String(error),
                  type: errorTypeForTelemetry(error),
                  aborted:
                    error instanceof Error &&
                    (error.name === 'AbortError' ||
                      ('workflowKiAborted' in error && error.workflowKiAborted === true)),
                },
              })
            );
          }
          reference = undefined;
          throw error;
        } finally {
          handlerContext.abortSignal.removeEventListener('abort', onAbort);
        }
      },
      verifyKi: (params) => verifyKiForStep(this.api, scopeId, handlerContext, params),
      put: ({ kiId, document, refresh = false }) =>
        restoreKiError(this.api.putRevision(scopeId, writeReference(), kiId, document, refresh)),
      update: (options) => updateKiWithRevisionOperations(options, operations),
      remove: (options) => softDeleteKiWithRevisionOperations(options, operations),
    };
    recordRemoteTiming('context_engine_ki_native_handler', {
      scopeId,
      stepId: handlerContext.stepId,
    });
    if (this.action === 'create') {
      const handler = createCreateKiHandler(dependencies);
      return handler(handlerContext as Parameters<typeof handler>[0]);
    }
    if (this.action === 'update') {
      const handler = createUpdateKiHandler(dependencies);
      return handler(handlerContext as Parameters<typeof handler>[0]);
    }
    const handler = createDeleteKiHandler(dependencies);
    return handler(handlerContext as Parameters<typeof handler>[0]);
  }
}

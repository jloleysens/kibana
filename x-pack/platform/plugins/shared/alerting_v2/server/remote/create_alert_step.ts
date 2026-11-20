/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { createAlertEventHandler } from '../lib/workflow_extensions/steps/create_alert_event_handler';
import { createAlertEvent } from '../lib/alert_events_client/alert_event_algorithms';
import { AlertEventStorageToken, type AlertEventStorageApi } from './tokens';
import { restoreAlertEventError } from './errors';
export class CreateAlertStep implements RemoteWorkflowStep {
  constructor(@inject(AlertEventStorageToken) private readonly api: AlertEventStorageApi) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    if (!context.handlerContext)
      throw new Error('Alert creation requires executor-local handler context');
    let reference: string | undefined;
    let cancellation: Promise<void> | undefined;
    const abort = () => {
      if (reference !== undefined)
        cancellation = restoreAlertEventError(this.api.close(scopeId, reference)).catch(
          (error: Error) => {
            context.handlerContext?.logger.debug('Alert creation cancellation: ' + error.message);
          }
        );
    };
    const handler = createAlertEventHandler(
      async () => {
        const prepared = await restoreAlertEventError(this.api.open(scopeId));
        reference = prepared.reference;
        if (context.handlerContext?.abortSignal.aborted) abort();
        return {
          createAlertEvent: (event, options) =>
            createAlertEvent(
              event,
              prepared.spaceId,
              {
                readLatest: () =>
                  restoreAlertEventError(this.api.readLatest(scopeId, prepared.reference, event)),
                persist: (doc) =>
                  restoreAlertEventError(this.api.persist(scopeId, prepared.reference, doc)),
              },
              options
            ),
        };
      },
      () => restoreAlertEventError(this.api.canWrite(scopeId)),
      (input) => restoreAlertEventError(this.api.parse(scopeId, input))
    );
    context.handlerContext.abortSignal.addEventListener('abort', abort, { once: true });
    recordRemoteTiming('alerting_create_alert_native_handler', { scopeId });
    try {
      return await handler(context.handlerContext);
    } finally {
      context.handlerContext.abortSignal.removeEventListener('abort', abort);
      await cancellation;
      if (reference !== undefined) await restoreAlertEventError(this.api.close(scopeId, reference));
    }
  }
}

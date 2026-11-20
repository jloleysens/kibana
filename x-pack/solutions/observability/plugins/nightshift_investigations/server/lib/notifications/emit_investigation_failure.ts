/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import type { GetTriggerEmitter } from '../../types';
import type { GetInvestigationsClient } from '../../routes/types';
import { INVESTIGATION_FAILED_TRIGGER_ID } from '../../../common/workflows/triggers';
/** Emits the original lifecycle payload without awaiting the trigger's work. */
export const emitInvestigationFailure = async ({
  request,
  getTriggerEmitter,
  client,
  investigationId,
}: {
  request: KibanaRequest;
  getTriggerEmitter: GetTriggerEmitter;
  client: Pick<ReturnType<GetInvestigationsClient>, 'getLifecycleSubject'>;
  investigationId: string;
}): Promise<void> => {
  const emitter = getTriggerEmitter(request);
  if (!emitter) return;
  const lifecycleSubject = await client.getLifecycleSubject(investigationId);
  if (lifecycleSubject)
    emitter(INVESTIGATION_FAILED_TRIGGER_ID, {
      investigation_id: investigationId,
      subject: lifecycleSubject.subject,
      trigger_type: lifecycleSubject.triggerType,
      started_at: lifecycleSubject.startedAt,
      status: 'failed',
      completed_at: new Date().toISOString(),
    });
};

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { GetInvestigationsClient } from '../routes/types';
import type { NotifiableInvestigation } from '../lib/notifications/notification_delivery';

type InvestigationsClient = ReturnType<GetInvestigationsClient>;
export interface InvestigationRenderingInput {
  investigation: NotifiableInvestigation;
  redirectUrl: string;
}
export interface InvestigationsApi {
  getRenderingInput(scopeId: string, investigationId: string): Promise<InvestigationRenderingInput>;
  followUpRecoveredAlert(
    scopeId: string,
    input: Parameters<InvestigationsClient['followUpRecoveredAlert']>[0]
  ): ReturnType<InvestigationsClient['followUpRecoveredAlert']>;
}
export const InvestigationsToken = createToken<InvestigationsApi>('nightshift.investigations');

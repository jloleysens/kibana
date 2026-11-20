/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { InvestigationDispatchDeps } from './trigger_investigation';

type DispatchDeps = InvestigationDispatchDeps<string>;
export interface InvestigationDispatchApi {
  prepare(scopeId: string, automationId?: string): Promise<string>;
  resolveAlerts(scopeId: string, subjectId: string): ReturnType<DispatchDeps['resolveAlerts']>;
  start(
    scopeId: string,
    reference: string,
    input: Parameters<DispatchDeps['start']>[1]
  ): ReturnType<DispatchDeps['start']>;
  notifyQuota(scopeId: string, reference: string, kibanaUrl: string): Promise<string[]>;
}
export const InvestigationDispatchToken = createToken<InvestigationDispatchApi>(
  'nightshift.investigationDispatch'
);

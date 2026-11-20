/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { AutomationDailyLimitReachedError, InvestigationQuotaDeniedError } from '../client/errors';
import {
  createInvestigationTransportError,
  restoreInvestigationError,
} from './investigation_errors';

export const createDispatchTransportError = (error: Error): Error => {
  const safe = createInvestigationTransportError(error);
  if (error instanceof AutomationDailyLimitReachedError)
    return Object.assign(safe, {
      workflowDispatchDenial: 'daily_limit',
      workflowDispatchDailyLimit: error.limit,
    });
  if (error instanceof InvestigationQuotaDeniedError)
    return Object.assign(safe, { workflowDispatchDenial: 'investigation_limit' });
  return safe;
};
export const restoreDispatchError = async <T>(result: Promise<T>): Promise<T> => {
  try {
    return await restoreInvestigationError(result);
  } catch (error) {
    if (error instanceof Error && 'workflowDispatchDenial' in error) {
      if (error.workflowDispatchDenial === 'daily_limit')
        throw new AutomationDailyLimitReachedError(
          'workflowDispatchDailyLimit' in error &&
          typeof error.workflowDispatchDailyLimit === 'number'
            ? error.workflowDispatchDailyLimit
            : undefined
        );
      if (error.workflowDispatchDenial === 'investigation_limit')
        throw new InvestigationQuotaDeniedError();
    }
    throw error;
  }
};

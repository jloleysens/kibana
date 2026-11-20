/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { KibanaApiCallError } from '@kbn/workflows-runtime';
import {
  createInvestigationTransportError,
  restoreInvestigationError,
} from './investigation_errors';

export const createReinforcementTransportError = (error: Error): Error => {
  const safe = createInvestigationTransportError(error);
  return error instanceof KibanaApiCallError
    ? Object.assign(safe, { workflowReinforcementHttpStatus: error.status })
    : safe;
};

export const restoreReinforcementError = async <T>(result: Promise<T>): Promise<T> => {
  try {
    return await restoreInvestigationError(result);
  } catch (error) {
    if (
      error instanceof Error &&
      'workflowReinforcementHttpStatus' in error &&
      typeof error.workflowReinforcementHttpStatus === 'number'
    )
      throw new KibanaApiCallError({
        status: error.workflowReinforcementHttpStatus,
        message: error.message,
        headers: {},
        body: undefined,
      });
    throw error;
  }
};

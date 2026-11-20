/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  createInvestigationTransportError,
  restoreInvestigationError,
} from './investigation_errors';

/** Only UNAVAILABLE is a public control fact: the original Cortex writer retries it once. */
export const createSandboxTransportError = (error: Error): Error => {
  const result = createInvestigationTransportError(error);
  return 'code' in error && error.code === 14
    ? Object.assign(result, { workflowSandboxUnavailable: true })
    : result;
};
export const restoreSandboxError = async <T>(result: Promise<T>): Promise<T> => {
  try {
    return await restoreInvestigationError(result);
  } catch (error) {
    if (
      error instanceof Error &&
      'workflowSandboxUnavailable' in error &&
      error.workflowSandboxUnavailable === true
    )
      Object.assign(error, { code: 14 });
    throw error;
  }
};

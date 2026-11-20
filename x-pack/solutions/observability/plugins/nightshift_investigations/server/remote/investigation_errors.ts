/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** Preserves error names and builtin retry types without exporting private client metadata. */
export const createInvestigationTransportError = (error: Error): Error => {
  const ErrorType =
    [EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError].find(
      (Constructor) => error instanceof Constructor
    ) ?? Error;
  return Object.assign(new ErrorType(error.message), {
    workflowInvestigationErrorName: error.name,
  });
};

export const restoreInvestigationError = async <T>(result: Promise<T>): Promise<T> => {
  try {
    return await result;
  } catch (error) {
    if (
      error instanceof Error &&
      'workflowInvestigationErrorName' in error &&
      typeof error.workflowInvestigationErrorName === 'string'
    )
      error.name = error.workflowInvestigationErrorName;
    throw error;
  }
};

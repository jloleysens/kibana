/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** Projects only public name/message and builtin retry type across Core's enumerable-error transport. */
export const createRegistryTransportError = (error: Error | string): Error => {
  const ErrorType =
    [EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError].find(
      (Constructor) => error instanceof Constructor
    ) ?? Error;
  const message = error instanceof Error ? error.message : error;
  const safe =
    error instanceof AggregateError ? new AggregateError([], message) : new ErrorType(message);
  return Object.assign(safe, {
    workflowContextEngineErrorName: error instanceof Error ? error.name : 'Error',
  });
};

/** Restores the original public name after RPC without reviving arbitrary private properties. */
export const restoreRegistryError = async <T>(result: Promise<T>): Promise<T> => {
  try {
    return await result;
  } catch (error) {
    if (
      error instanceof Error &&
      'workflowContextEngineErrorName' in error &&
      typeof error.workflowContextEngineErrorName === 'string'
    )
      error.name = error.workflowContextEngineErrorName;
    throw error;
  }
};

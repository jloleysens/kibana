/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  NightshiftModelBlockedError,
  NightshiftModelNotFoundError,
} from '@kbn/significant-events-runtime';

export const createSignificantEventsTransportError = (error: Error | string): Error => {
  const ErrorType =
    [EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError].find(
      (Constructor) => error instanceof Constructor
    ) ?? Error;
  const message = error instanceof Error ? error.message : error;
  const safe =
    error instanceof AggregateError ? new AggregateError([], message) : new ErrorType(message);
  return Object.assign(safe, {
    significantEventsErrorName: error instanceof Error ? error.name : 'Error',
  });
};

export const restoreSignificantEventsError = async <T>(result: Promise<T>): Promise<T> => {
  try {
    return await result;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const name =
      'significantEventsErrorName' in error ? error.significantEventsErrorName : error.name;
    const restored =
      name === 'NightshiftModelBlockedError'
        ? new NightshiftModelBlockedError('')
        : name === 'NightshiftModelNotFoundError'
        ? new NightshiftModelNotFoundError('')
        : error;
    restored.message = error.message;
    if (typeof name === 'string') restored.name = name;
    throw restored;
  }
};

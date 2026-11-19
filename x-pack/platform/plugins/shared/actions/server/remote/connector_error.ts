/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** Copies only error identity and message, never service request metadata or causes. */
export const sanitizeConnectorError = (error: Error): Error => {
  const ErrorConstructor =
    error instanceof TypeError
      ? TypeError
      : error instanceof RangeError
      ? RangeError
      : error instanceof ReferenceError
      ? ReferenceError
      : error instanceof SyntaxError
      ? SyntaxError
      : error instanceof URIError
      ? URIError
      : error instanceof EvalError
      ? EvalError
      : Error;
  const safe = new ErrorConstructor(
    error instanceof Error ? error.message : 'Native connector service failed'
  );
  safe.name = error instanceof Error ? error.name : 'Error';
  delete safe.stack;
  return safe;
};

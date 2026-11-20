/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { isRequestAbortedError } from '@kbn/es-errors';
/** Whether the error is a cancellation. */
export const isAbortError = (error: unknown): boolean =>
  isRequestAbortedError(error) || (error instanceof Error && error.name === 'AbortError');

export { errorTypeForTelemetry } from './error_type';

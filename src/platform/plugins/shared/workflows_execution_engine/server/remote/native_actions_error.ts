/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { sanitizeConnectorError } from '@kbn/actions-plugin/server/remote/connector_error';
import type { Logger } from '@kbn/core/server';

/** Keeps service request metadata coordinator-side while preserving native error classification. */
export const withNativeActionsErrorBoundary = async <T>(
  operation: () => Promise<T>,
  logger?: Pick<Logger, 'error'>
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    logger?.error(error);
    throw sanitizeConnectorError(error);
  }
};

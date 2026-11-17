/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { KibanaRequest } from '@kbn/core/server';
import type { WorkflowDispatchCredentials } from './tokens';

/** PoC fallback: supplies a memory-only internal credential alongside the restored run identity. */
export const workflowDispatchCredentials = (
  request: KibanaRequest
): WorkflowDispatchCredentials | undefined => {
  const node = process.env.KBN_RUNNER_ES_NODE;
  if (!node) return;
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string') {
    throw new Error('Worker dispatch requires a restored run-user authorization header');
  }
  const source = process.env.KBN_RUNNER_INTERNAL_HEADERS;
  if (!source) throw new Error('Worker dispatch internal authorization is not configured');
  let internalHeaders: Record<string, string>;
  try {
    internalHeaders = JSON.parse(source);
    if (
      !internalHeaders ||
      Array.isArray(internalHeaders) ||
      !Object.values(internalHeaders).every((value) => typeof value === 'string') ||
      !internalHeaders.authorization
    ) {
      throw new Error('Invalid headers');
    }
  } catch {
    // Parser errors can include credential text; never propagate them across the diagnostic seam.
    throw new Error('Invalid worker internal authorization configuration');
  }
  return { node, internalHeaders, userHeaders: { authorization } };
};

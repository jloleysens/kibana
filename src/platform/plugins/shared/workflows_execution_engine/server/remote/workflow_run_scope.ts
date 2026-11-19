/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ScopeLookup } from '@kbn/core-remote-server';

export const assertWorkflowRunScope = (
  scopes: ScopeLookup,
  scopeId: string,
  workflowRunId: string,
  spaceId?: string
): ReturnType<ScopeLookup['getRunState']> => {
  scopes.get(scopeId);
  const state = scopes.getRunState(scopeId);
  if (state.workflowRunId !== workflowRunId || (spaceId !== undefined && state.spaceId !== spaceId))
    throw new Error('Workflow resource is outside the scoped execution');
  return state;
};

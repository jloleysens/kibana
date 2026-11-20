/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License, v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ScopeLookup } from './contracts';

export interface RemoteLeaseParent {
  readonly token: object;
  readonly runId: string;
  readonly isActive: () => boolean;
}
interface ScopedLeaseParent {
  readonly token: object;
  readonly signal: AbortSignal;
}
const parents = new WeakMap<ScopeLookup, (scopeId: string) => ScopedLeaseParent | undefined>();
const context = new AsyncLocalStorage<RemoteLeaseParent>();

/** Core binds opaque pool-owned lease tokens to coordinator-only scope lookups. */
export const registerRemoteLeaseParents = (
  scopes: ScopeLookup,
  resolve: (scopeId: string) => ScopedLeaseParent | undefined
): void => {
  parents.set(scopes, resolve);
};

/** Marks synchronous coordinator work as belonging to its verified active lease, never to a worker claim. */
export const withRemoteLeaseParent = async <T>(
  scopes: ScopeLookup,
  scopeId: string,
  work: () => Promise<T>
): Promise<T> => {
  const parent = parents.get(scopes)?.(scopeId);
  if (!parent) return work();
  parent.signal.throwIfAborted();
  const { workflowRunId } = scopes.getRunState(scopeId);
  let active = true;
  return context.run(
    { token: parent.token, runId: workflowRunId, isActive: () => active && !parent.signal.aborted },
    async () => {
      try {
        return await work();
      } finally {
        active = false;
      }
    }
  );
};

/** Reads capacity-only ancestry inside the coordinator; tokens are never transported. */
export const getRemoteLeaseParent = (): RemoteLeaseParent | undefined => {
  const parent = context.getStore();
  return parent?.isActive() ? parent : undefined;
};

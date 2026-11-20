/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import pLimit from 'p-limit';

const tokenRefreshLocks = new Map<string, ReturnType<typeof pLimit>>();

/** Serializes ordinary and remote refreshes for the same connector/user on the coordinator. */
export const withConnectorTokenRefreshLock = async <T>(
  key: string,
  refresh: () => Promise<T>
): Promise<T> => {
  let lock = tokenRefreshLocks.get(key);
  if (!lock) {
    lock = pLimit(1);
    tokenRefreshLocks.set(key, lock);
  }
  try {
    return await lock(refresh);
  } finally {
    if (lock.pendingCount === 0 && lock.activeCount === 0) tokenRefreshLocks.delete(key);
  }
};

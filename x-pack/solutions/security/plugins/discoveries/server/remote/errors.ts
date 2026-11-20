/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export const restoreAttackDiscoveryError = async <T>(operation: Promise<T>): Promise<T> => {
  try {
    return await operation;
  } catch (error) {
    if (
      error instanceof Error &&
      'attackDiscoveryErrorName' in error &&
      typeof error.attackDiscoveryErrorName === 'string'
    )
      error.name = error.attackDiscoveryErrorName;
    throw error;
  }
};

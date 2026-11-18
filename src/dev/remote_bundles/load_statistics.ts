/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/** Returns an observed nearest-rank percentile, without interpolating tail samples. */
export const nearestRank = (values: readonly number[], quantile: number): number => {
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    throw new Error('Expected nonempty finite samples');
  }
  if (!Number.isFinite(quantile) || quantile <= 0 || quantile > 1) {
    throw new Error('Expected a quantile in (0, 1]');
  }
  return [...values].sort((left, right) => left - right)[Math.ceil(values.length * quantile) - 1];
};

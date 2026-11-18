/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { nearestRank } from './load_statistics';

describe('nearestRank', () => {
  it('keeps the observed p99 tail and does not mutate raw samples', () => {
    const samples = Array.from({ length: 1000 }, (_, index) => 1000 - index);
    expect(nearestRank(samples, 0.5)).toBe(500);
    expect(nearestRank(samples, 0.99)).toBe(990);
    expect(nearestRank(samples, 1)).toBe(1000);
    expect(samples[0]).toBe(1000);
  });

  it.each([{ samples: [] }, { samples: [NaN] }, { samples: [Infinity] }])(
    'refuses missing or invalid samples $samples',
    ({ samples }) => {
      expect(() => nearestRank(samples, 0.99)).toThrow('nonempty finite samples');
    }
  );

  it.each([0, -1, 1.1, NaN])('refuses invalid quantile %s', (quantile) => {
    expect(() => nearestRank([1], quantile)).toThrow('quantile');
  });
});

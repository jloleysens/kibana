/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { take } from 'lodash';
import { truncateList } from './truncate_list';

it.each([0, 1, 2, 4, 10, -1, 1.5, Infinity, NaN])(
  'preserves the original lodash take result for limit %s',
  (limit) => {
    const values = ['one', 'two', 'three', 'four'];
    const original =
      values.length <= limit
        ? values
        : [...take(values, limit), `${values.length - limit} more values`];
    expect(truncateList(values, limit)).toEqual(original);
    if (values.length <= limit) expect(truncateList(values, limit)).toBe(values);
    expect(values).toEqual(['one', 'two', 'three', 'four']);
  }
);

it('retains element identities and the empty-list fast path', () => {
  const values = [{ id: 1 }, { id: 2 }];
  expect(truncateList(values, 1)[0]).toBe(values[0]);
  const empty: string[] = [];
  expect(truncateList(empty, 0)).toBe(empty);
});

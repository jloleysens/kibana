/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { ByteSizeValue } from '@kbn/config-schema';
import { resolveStepOutputLimit } from './resolve_step_output_limit';

it.each([
  ['1kb', '2kb', 3072, 1024],
  [undefined, '2kb', 3072, 2048],
  [undefined, undefined, 3072, 3072],
  [undefined, undefined, undefined, 10 * 1024 * 1024],
  ['invalid', '2kb', 3072, 10 * 1024 * 1024],
  [undefined, 'invalid', 3072, 10 * 1024 * 1024],
  ['0b', '2kb', 3072, 0],
  [undefined, undefined, 0, 0],
] as const)('shares exact local precedence (%s / %s / %s)', (step, workflow, plugin, expected) => {
  expect(resolveStepOutputLimit(step, workflow, () => plugin)).toBe(expected);
});
it('uses original ByteSizeValue plugin configuration and preserves fallback on a configuration failure', () => {
  expect(resolveStepOutputLimit(undefined, undefined, () => ByteSizeValue.parse('4kb'))).toBe(4096);
  expect(
    resolveStepOutputLimit(undefined, undefined, () => {
      throw new Error('unavailable');
    })
  ).toBe(10 * 1024 * 1024);
});
it('does not read plugin configuration if a more specific limit applies', () => {
  const plugin = jest.fn(() => 3072);
  expect(resolveStepOutputLimit('1kb', '2kb', plugin)).toBe(1024);
  expect(plugin).not.toHaveBeenCalled();
});

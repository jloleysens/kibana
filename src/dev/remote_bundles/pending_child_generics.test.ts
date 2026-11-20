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

import { accountPendingChildGenerics } from './pending_child_generics';
const ledger =
  '| nightshift.sendNotifications | unfinished | pending |\n| nightshift.resolveModel | typed capability | placed |';
it('retains every child call by authoritative child run/type and explicit pending owner', () => {
  const call = {
    executionId: 'child',
    scopeId: 'child-scope',
    stepType: 'nightshift.sendNotifications',
  };
  expect(accountPendingChildGenerics([call, call], 'outer', 2, ledger)).toEqual([
    {
      executionId: 'child',
      stepType: call.stepType,
      count: 2,
      category: 'unfinished',
      owner: 'lane B',
    },
  ]);
});
it.each([
  [{ executionId: 'outer', stepType: 'nightshift.sendNotifications' }, 1],
  [{ executionId: 'child', stepType: 'nightshift.resolveModel' }, 1],
  [{ executionId: 'child', stepType: 'nightshift.triggerInvestigation' }, 1],
  [{ executionId: 'child', stepType: 'unknown' }, 1],
  [{ executionId: 'child', stepType: 'nightshift.sendNotifications' }, 2],
] as const)(
  'refuses outer, non-pending, target, unknown or unaccounted generic calls (%p)',
  (call, count) => {
    expect(() => accountPendingChildGenerics([call], 'outer', count, ledger)).toThrow();
  }
);

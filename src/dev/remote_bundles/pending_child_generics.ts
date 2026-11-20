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

import assert from 'node:assert/strict';

interface GenericCall {
  executionId?: string;
  scopeId?: string;
  stepType: string;
}

export const accountPendingChildGenerics = (
  calls: GenericCall[],
  outerRunId: string,
  invokeCount: number,
  ledger: string
) => {
  assert.equal(
    calls.length,
    invokeCount,
    'Every generic invocation needs a coordinator-authored identity'
  );
  const rows = new Map(
    ledger
      .split('\n')
      .filter((line) => line.startsWith('| '))
      .map((line) => {
        const [, type, category] = line.split('|').map((cell) => cell.trim());
        return [type, category];
      })
  );
  const counts = new Map<
    string,
    { executionId: string; stepType: string; count: number; category: string; owner: string }
  >();
  for (const { executionId, stepType } of calls) {
    assert(
      executionId && executionId !== outerRunId,
      'Outer target run invoked a generic coordinator handler'
    );
    assert.notEqual(
      stepType,
      'nightshift.triggerInvestigation',
      'Target trigger handler must never be generic'
    );
    assert.equal(
      rows.get(stepType),
      'unfinished',
      `Generic call from non-pending ledger type: ${stepType}`
    );
    const owner = stepType.startsWith('nightshift.')
      ? 'lane B'
      : /^(significantEvents\.|alerting\.|entityStore\.|elasticAssistant\.|alertzero\.|hunt\.|threat_intel\.)/.test(
          stepType
        )
      ? 'lane C'
      : undefined;
    assert(owner, `Pending generic type needs an assigned owner: ${stepType}`);
    const key = JSON.stringify([executionId, stepType]);
    const row = counts.get(key) ?? {
      executionId,
      stepType,
      count: 0,
      category: 'unfinished',
      owner,
    };
    row.count++;
    counts.set(key, row);
  }
  return [...counts.values()];
};

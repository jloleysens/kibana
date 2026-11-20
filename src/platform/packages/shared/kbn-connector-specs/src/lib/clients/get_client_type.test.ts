/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { clientTypes } from '.';
import { getClientType } from './get_client_type';

it('resolves every original factory by identity and rejects unknown/inherited names', async () => {
  for (const [id, factory] of Object.entries(clientTypes)) {
    expect(await getClientType(id)).toBe(factory);
  }
  expect(await getClientType('unknown')).toBeUndefined();
  expect(await getClientType('constructor')).toBeUndefined();
});

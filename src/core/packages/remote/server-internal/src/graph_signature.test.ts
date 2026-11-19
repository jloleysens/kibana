/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { RemoteWorkerSpec } from '@kbn/core-remote-common';
import { graphSignature } from './graph_signature';

it('refuses a contribution kind change even if its name and implementation export stay the same', () => {
  const spec: RemoteWorkerSpec = {
    id: 'graph',
    root: { tokenId: 'root', modulePath: 'root.ts', exportName: 'Root' },
    coordinatorTokenIds: [],
    executorProviders: [],
    contributions: [
      { kindId: 'kind.one', stepType: 'example', modulePath: 'example.ts', exportName: 'Example' },
    ],
  };
  expect(graphSignature(spec)).not.toBe(
    graphSignature({
      ...spec,
      contributions: spec.contributions.map((contribution) => ({
        ...contribution,
        kindId: 'kind.two',
      })),
    })
  );
});

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { createHash } from 'node:crypto';
import type { RemoteWorkerSpec } from '@kbn/core-remote-common';

/** Refuses stale bundles whose declared capabilities, providers or step registrations differ. */
export const graphSignature = (spec: RemoteWorkerSpec): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        id: spec.id,
        root: [spec.root.tokenId, spec.root.exportName],
        catalog: spec.catalog ? [spec.catalog.tokenId, spec.catalog.exportName] : null,
        providers: spec.executorProviders
          .map(({ tokenId, exportName }) => `${tokenId}:${exportName}`)
          .sort(),
        coordinator: [...spec.coordinatorTokenIds].sort(),
        steps: spec.contributions
          .map(({ stepType, exportName }) => `${stepType}:${exportName}`)
          .sort(),
      })
    )
    .digest('hex');

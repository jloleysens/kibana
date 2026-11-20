/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { verifyRemoteSourceDigest } from '@kbn/core-remote-common';
import type { RemoteContributionSourceDigest } from '@kbn/core-remote-common';
import type { SavedObjectsType } from '@kbn/core-saved-objects-server';
import type { WorkerSavedObjectsType } from './worker_saved_objects';

export interface WorkerSavedObjectsTypeContribution {
  readonly metadata: RemoteContributionSourceDigest;
  /** Original local factory results selected by the same manifest entry, not deserialized definitions. */
  readonly types: readonly SavedObjectsType[];
}

/** Binds generated closure digests to original factory results without a per-plugin digest registry. */
export const verifyWorkerSavedObjectsTypeSources = (
  contributions: readonly WorkerSavedObjectsTypeContribution[],
  readSource: (path: string) => string
): readonly WorkerSavedObjectsType[] => {
  const contributionIds = new Set<string>();
  const typeNames = new Set<string>();
  const result: WorkerSavedObjectsType[] = [];
  for (const { metadata, types } of contributions) {
    if (
      metadata.kindId !== 'core.savedObjects.types' ||
      !metadata.contributionId ||
      !metadata.exportName ||
      contributionIds.has(metadata.contributionId) ||
      types.length === 0
    ) {
      throw new Error('Invalid saved object type source contribution');
    }
    contributionIds.add(metadata.contributionId);
    const sourceDigest = verifyRemoteSourceDigest(metadata, readSource);
    for (const type of types) {
      if (typeNames.has(type.name)) {
        throw new Error(`Duplicate saved object source for '${type.name}'`);
      }
      typeNames.add(type.name);
      result.push(Object.freeze({ type, sourceDigest }));
    }
  }
  return Object.freeze(result);
};

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { digestRemoteSources } from '@kbn/core-remote-common';
import type { RemoteContributionSourceDigest } from '@kbn/core-remote-common';
import type { SavedObjectsType } from '@kbn/core-saved-objects-server';
import { SavedObjectTypeRegistry } from '@kbn/core-saved-objects-base-server-internal';
import { verifyWorkerSavedObjectsTypeSources } from './worker_saved_objects_type_sources';
import { WorkerSavedObjectsAdmissionProducer } from './worker_saved_objects_admission';

const type: SavedObjectsType = {
  name: 'business',
  hidden: false,
  namespaceType: 'single',
  mappings: { properties: { title: { type: 'keyword' } } },
};
const metadata: RemoteContributionSourceDigest = {
  kindId: 'core.savedObjects.types',
  contributionId: 'example',
  modulePath: 'types.ts',
  exportName: 'createTypes',
  sources: ['types.ts'],
  digest: digestRemoteSources([{ path: 'types.ts', source: 'original' }]),
};

it('binds generated closure metadata to original local factory types for coordinator admission', async () => {
  const types = verifyWorkerSavedObjectsTypeSources(
    [{ metadata, types: [type] }],
    () => 'original'
  );
  expect(types).toEqual([{ type, sourceDigest: metadata.digest }]);
  expect(types[0].type).toBe(type);
  expect(Object.isFrozen(types)).toBe(true);
  expect(Object.isFrozen(types[0])).toBe(true);
  const digests = new Map(types.map((entry) => [entry.type.name, entry.sourceDigest]));
  const registry = new SavedObjectTypeRegistry();
  registry.registerType(type);
  const producer = new WorkerSavedObjectsAdmissionProducer({
    buildIdentity: 'build',
    typeRegistry: registry,
    getSourceDigest: (name) => digests.get(name) ?? '',
    assertMigrationsReady: async () => undefined,
  });
  const admission = await producer.create(['business']);
  expect(admission.types[0].sourceDigest).toBe(metadata.digest);
  await expect(producer.verify(admission)).resolves.toBeUndefined();
});

it('refuses stale original source without creating any usable typed factory result', () => {
  expect(() =>
    verifyWorkerSavedObjectsTypeSources([{ metadata, types: [type] }], () => 'stale')
  ).toThrow('source mismatch');
});

it.each([{ kindId: 'workflows.step' }, { contributionId: '' }, { exportName: '' }])(
  'refuses invalid contribution identities: %j',
  (invalid) => {
    expect(() =>
      verifyWorkerSavedObjectsTypeSources(
        [{ metadata: { ...metadata, ...invalid }, types: [type] }],
        () => 'original'
      )
    ).toThrow('source contribution');
  }
);

it('refuses empty factories, duplicate contributions and overlapping original type ownership', () => {
  const contribution = { metadata, types: [type] };
  for (const contributions of [
    [{ metadata, types: [] }],
    [contribution, contribution],
    [contribution, { ...contribution, metadata: { ...metadata, contributionId: 'other' } }],
  ]) {
    expect(() => verifyWorkerSavedObjectsTypeSources(contributions, () => 'original')).toThrow();
  }
});

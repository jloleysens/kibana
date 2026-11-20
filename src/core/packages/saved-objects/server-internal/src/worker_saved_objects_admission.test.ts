/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { SavedObjectTypeRegistry } from '@kbn/core-saved-objects-base-server-internal';
import { savedObjectsTypeParity } from './saved_objects_type_parity';
import { WorkerSavedObjectsAdmissionProducer } from './worker_saved_objects_admission';

const sourceDigest = 'a'.repeat(64);
const createProducer = () => {
  const typeRegistry = new SavedObjectTypeRegistry();
  typeRegistry.registerType({
    name: 'business',
    hidden: false,
    namespaceType: 'single',
    mappings: { properties: { title: { type: 'keyword' } } },
  });
  const assertMigrationsReady = jest.fn(async () => undefined);
  const getSourceDigest = jest.fn(() => sourceDigest);
  return {
    producer: new WorkerSavedObjectsAdmissionProducer({
      buildIdentity: 'coordinator-build',
      typeRegistry,
      getSourceDigest,
      assertMigrationsReady,
    }),
    typeRegistry,
    assertMigrationsReady,
    getSourceDigest,
  };
};

describe('WorkerSavedObjectsAdmissionProducer', () => {
  it('uses the actual coordinator registry and freezes its wire metadata', async () => {
    const { producer, typeRegistry, getSourceDigest } = createProducer();
    const admission = await producer.create(['business']);
    expect(admission).toEqual({
      buildIdentity: 'coordinator-build',
      types: [savedObjectsTypeParity(typeRegistry.getAllTypes()[0], sourceDigest)],
    });
    expect(getSourceDigest).toHaveBeenCalledWith('business');
    expect(Object.isFrozen(admission)).toBe(true);
    expect(Object.isFrozen(admission.types)).toBe(true);
    expect(Object.isFrozen(admission.types[0])).toBe(true);
  });

  it.each([{ names: [] }, { names: ['business', 'business'] }, { names: ['not-registered'] }])(
    'refuses an empty, duplicate or unregistered type set: $names',
    async ({ names }) => {
      const { producer } = createProducer();
      await expect(producer.create(names)).rejects.toThrow();
    }
  );

  it('refuses missing or invalid generated source metadata', async () => {
    const { producer, getSourceDigest } = createProducer();
    getSourceDigest.mockReturnValue('');
    await expect(producer.create(['business'])).rejects.toThrow('original-source digest');
  });

  it('checks completed migrations on every creation and verification, not once per registry', async () => {
    const { producer, assertMigrationsReady } = createProducer();
    const admission = await producer.create(['business']);
    await producer.verify(admission);
    expect(assertMigrationsReady).toHaveBeenCalledTimes(2);
    assertMigrationsReady.mockRejectedValue(new Error('Migration running'));
    await expect(producer.verify(admission)).rejects.toThrow('Migration running');
    await expect(producer.create(['business'])).rejects.toThrow('Migration running');
  });

  it.each(['build', 'source', 'structure', 'duplicate'] as const)(
    'refuses %s tampering against independent coordinator metadata',
    async (mismatch) => {
      const { producer } = createProducer();
      const admission = await producer.create(['business']);
      const changed = {
        buildIdentity: mismatch === 'build' ? 'other-build' : admission.buildIdentity,
        types:
          mismatch === 'duplicate'
            ? [...admission.types, admission.types[0]]
            : admission.types.map((type) => ({
                ...type,
                sourceDigest: mismatch === 'source' ? 'b'.repeat(64) : type.sourceDigest,
                structureDigest: mismatch === 'structure' ? 'b'.repeat(64) : type.structureDigest,
              })),
      };
      await expect(producer.verify(changed)).rejects.toThrow();
    }
  );

  it('detects a live registered structure change instead of trusting a prior admission', async () => {
    const { producer, typeRegistry } = createProducer();
    const admission = await producer.create(['business']);
    jest.spyOn(typeRegistry, 'getType').mockReturnValue({
      ...typeRegistry.getAllTypes()[0],
      mappings: { properties: { other: { type: 'text' } } },
    });
    await expect(producer.verify(admission)).rejects.toThrow('parity mismatch');
  });

  it('snapshots names and verification input before migration verification yields', async () => {
    const { producer } = createProducer();
    const names = ['business'];
    const creating = producer.create(names);
    names.length = 0;
    const admission = await creating;
    const input = { buildIdentity: admission.buildIdentity, types: [...admission.types] };
    const verifying = producer.verify(input);
    input.buildIdentity = 'changed';
    input.types.length = 0;
    await expect(verifying).resolves.toBeUndefined();
  });
});

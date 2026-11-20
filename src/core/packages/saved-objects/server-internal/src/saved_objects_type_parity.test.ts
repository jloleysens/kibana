/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { schema } from '@kbn/config-schema';
import type { SavedObjectUnsanitizedDoc, SavedObjectsType } from '@kbn/core-saved-objects-server';
import { resolveSavedObjectsType, savedObjectsTypeParity } from './saved_objects_type_parity';

const sourceDigest = 'a'.repeat(64);
const createType = (overrides: Partial<SavedObjectsType> = {}): SavedObjectsType => ({
  name: 'business',
  hidden: false,
  namespaceType: 'single',
  mappings: { properties: { title: { type: 'keyword' } } },
  ...overrides,
});

describe('savedObjectsTypeParity', () => {
  it('normalizes object key order, not model change order', () => {
    const first = createType({
      mappings: { properties: { b: { type: 'text' }, a: { type: 'keyword' } } },
    });
    const second = createType({
      mappings: { properties: { a: { type: 'keyword' }, b: { type: 'text' } } },
    });
    expect(savedObjectsTypeParity(first, sourceDigest)).toEqual(
      savedObjectsTypeParity(second, sourceDigest)
    );
    const changes = [
      { type: 'mappings_addition' as const, addedMappings: { a: { type: 'keyword' as const } } },
      { type: 'data_removal' as const, removedAttributePaths: ['old'] },
    ];
    expect(
      savedObjectsTypeParity(createType({ modelVersions: { 1: { changes } } }), sourceDigest)
    ).not.toEqual(
      savedObjectsTypeParity(
        createType({ modelVersions: { 1: { changes: [...changes].reverse() } } }),
        sourceDigest
      )
    );
  });

  it.each<Partial<SavedObjectsType>>([
    { namespaceType: 'multiple' },
    { hidden: true },
    { indexPattern: 'other' },
    { supportsAccessControl: true },
    { mappings: { properties: { title: { type: 'text' } } } },
    { migrations: { '8.0.0': (document) => document } },
    { modelVersions: { 1: { changes: [] } } },
    { schemas: { '8.0.0': schema.object({ title: schema.string() }) } },
    { excludeOnUpgrade: async () => ({ match_all: {} }) },
    { typeVersionGuesser: () => 1 },
  ])('detects live metadata changes: %p', (overrides) => {
    expect(savedObjectsTypeParity(createType(overrides), sourceDigest).structureDigest).not.toEqual(
      savedObjectsTypeParity(createType(), sourceDigest).structureDigest
    );
  });

  it('detects config-dependent schema constraints with identical original source', () => {
    const makeSchema = (maxLength: number) =>
      createType({
        modelVersions: {
          1: {
            changes: [],
            schemas: { create: schema.object({ title: schema.string({ maxLength }) }) },
          },
        },
      });
    expect(savedObjectsTypeParity(makeSchema(10), sourceDigest)).not.toEqual(
      savedObjectsTypeParity(makeSchema(20), sourceDigest)
    );
  });

  it('uses the source digest for executable semantics, never transpiled function text', () => {
    const first = createType({ migrations: { '8.0.0': (document) => document } });
    const second = createType({
      migrations: { '8.0.0': (document) => ({ ...document, attributes: {} }) },
    });
    expect(savedObjectsTypeParity(first, sourceDigest).structureDigest).toEqual(
      savedObjectsTypeParity(second, sourceDigest).structureDigest
    );
    expect(savedObjectsTypeParity(first, sourceDigest)).not.toEqual(
      savedObjectsTypeParity(second, 'b'.repeat(64))
    );
  });

  it.each(['', 'unverified', 'A'.repeat(64)])(
    'refuses missing/invalid generated source digests',
    (digest) => {
      expect(() => savedObjectsTypeParity(createType(), digest)).toThrow('original-source digest');
    }
  );

  it('resolves deferred suppliers once for admission and subsequent migration preparation', () => {
    const migrations = jest.fn(() => ({
      '8.0.0': (document: SavedObjectUnsanitizedDoc) => document,
    }));
    const schemas = jest.fn(() => ({ '8.0.0': schema.object({}) }));
    const modelVersions = jest.fn(() => ({ 1: { changes: [] } }));
    const resolved = resolveSavedObjectsType(createType({ migrations, schemas, modelVersions }));
    savedObjectsTypeParity(resolved, sourceDigest);
    savedObjectsTypeParity(resolved, sourceDigest);
    expect(migrations).toHaveBeenCalledTimes(1);
    expect(schemas).toHaveBeenCalledTimes(1);
    expect(modelVersions).toHaveBeenCalledTimes(1);
  });
});

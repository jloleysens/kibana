/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { createHash } from 'node:crypto';
import type {
  SavedObjectsModelChange,
  SavedObjectsModelVersionMap,
  SavedObjectMigrationMap,
  SavedObjectsValidationMap,
  SavedObjectsValidationSpec,
  SavedObjectModelVersionForwardCompatibilityFn,
  SavedObjectsType,
} from '@kbn/core-saved-objects-server';

type StructuralValue = null | undefined | boolean | string | number | object;

type ResolvedSavedObjectsType = Omit<
  SavedObjectsType,
  'migrations' | 'schemas' | 'modelVersions'
> & {
  migrations?: SavedObjectMigrationMap;
  schemas?: SavedObjectsValidationMap;
  modelVersions?: SavedObjectsModelVersionMap;
};

export interface SavedObjectsTypeParity {
  readonly name: string;
  readonly sourceDigest: string;
  readonly structureDigest: string;
}

export const assertSavedObjectsTypeParity = (
  local: readonly SavedObjectsTypeParity[],
  coordinator: readonly SavedObjectsTypeParity[]
): void => {
  const expected = new Map(coordinator.map((type) => [type.name, type]));
  if (expected.size !== coordinator.length || local.length !== coordinator.length) {
    throw new Error('Worker saved object type set does not match coordinator');
  }
  for (const type of local) {
    const match = expected.get(type.name);
    if (
      !match ||
      match.sourceDigest !== type.sourceDigest ||
      match.structureDigest !== type.structureDigest
    ) {
      throw new Error(`Worker saved object parity mismatch for '${type.name}'`);
    }
  }
};

// Executable semantics belong to the generated original-source digest, never Function.toString().
const canonicalStructure = (value: StructuralValue, ancestors = new Set<object>()): string => {
  if (value === undefined) return 'undefined;';
  if (typeof value === 'function') return 'function;';
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Non-finite saved object structural metadata');
    }
    return `${typeof value}:${JSON.stringify(value)};`;
  }
  if (value instanceof RegExp) return `regexp:${JSON.stringify([value.source, value.flags])};`;
  if (ancestors.has(value)) throw new Error('Cyclic saved object structural metadata');
  ancestors.add(value);
  try {
    if (Array.isArray(value))
      return `[${value.map((entry) => canonicalStructure(entry, ancestors)).join(',')}]`;
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new Error('Unsupported saved object structural metadata');
    }
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalStructure(entry, ancestors)}`)
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
};

const schemaStructure = (
  schema: SavedObjectsValidationSpec | SavedObjectModelVersionForwardCompatibilityFn | undefined
): StructuralValue => (typeof schema === 'function' ? 'function' : schema?.getSchema().describe());

const changeStructure = (change: SavedObjectsModelChange): StructuralValue => {
  switch (change.type) {
    case 'data_backfill':
      return { type: change.type, backfillFn: typeof change.backfillFn };
    case 'unsafe_transform':
      return { type: change.type, transformFn: typeof change.transformFn };
    default:
      return change;
  }
};

/** Resolves deferred definitions once so admission and the document migrator use the same model. */
export const resolveSavedObjectsType = (type: SavedObjectsType): ResolvedSavedObjectsType => ({
  ...type,
  migrations: typeof type.migrations === 'function' ? type.migrations() : type.migrations,
  schemas: typeof type.schemas === 'function' ? type.schemas() : type.schemas,
  modelVersions:
    typeof type.modelVersions === 'function' ? type.modelVersions() : type.modelVersions,
});

/** Describes live storage metadata; original-source digests separately cover executable semantics. */
export const savedObjectsTypeParity = (
  type: SavedObjectsType,
  sourceDigest: string
): SavedObjectsTypeParity => {
  if (!/^[a-f0-9]{64}$/.test(sourceDigest)) {
    throw new Error(`Missing original-source digest for saved object type '${type.name}'`);
  }
  const resolved = resolveSavedObjectsType(type);
  const models = Object.fromEntries(
    Object.entries(resolved.modelVersions ?? {}).map(([version, model]) => [
      version,
      {
        changes: model.changes.map(changeStructure),
        schemas: {
          create: schemaStructure(model.schemas?.create),
          update: schemaStructure(model.schemas?.update),
          forwardCompatibility: schemaStructure(model.schemas?.forwardCompatibility),
        },
      },
    ])
  );
  const schemas = Object.fromEntries(
    Object.entries(resolved.schemas ?? {}).map(([version, schema]) => [
      version,
      schema.getSchema().describe(),
    ])
  );
  const structure = canonicalStructure({
    name: resolved.name,
    nameAttribute: resolved.nameAttribute,
    hidden: resolved.hidden,
    hiddenFromHttpApis: resolved.hiddenFromHttpApis,
    namespaceType: resolved.namespaceType,
    indexPattern: resolved.indexPattern,
    convertToAliasScript: resolved.convertToAliasScript,
    convertToMultiNamespaceTypeVersion: resolved.convertToMultiNamespaceTypeVersion,
    supportsAccessControl: resolved.supportsAccessControl,
    mappings: resolved.mappings,
    migrations: Object.keys(resolved.migrations ?? {}).sort(),
    schemas,
    models,
    excludeOnUpgrade: typeof resolved.excludeOnUpgrade,
    typeVersionGuesser: typeof resolved.typeVersionGuesser,
  });
  return {
    name: resolved.name,
    sourceDigest,
    structureDigest: createHash('sha256').update(structure).digest('hex'),
  };
};

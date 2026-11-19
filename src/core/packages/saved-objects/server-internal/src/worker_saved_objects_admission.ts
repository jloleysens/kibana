/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ISavedObjectTypeRegistry } from '@kbn/core-saved-objects-server';
import type { WorkerSavedObjectsAdmission } from './worker_saved_objects';
import { assertSavedObjectsTypeParity, savedObjectsTypeParity } from './saved_objects_type_parity';

export interface WorkerSavedObjectsAdmissionDependencies {
  readonly buildIdentity: string;
  readonly typeRegistry: ISavedObjectTypeRegistry;
  /** Resolves independently verified, manifest-generated original-source digests, never worker input. */
  readonly getSourceDigest: (typeName: string) => string;
  /** Checks the original coordinator migrator, not service availability or migrations.skip. */
  readonly assertMigrationsReady: () => Promise<void>;
}

/** Produces and verifies lease admission against the coordinator's actual registered storage model. */
export class WorkerSavedObjectsAdmissionProducer {
  private readonly dependencies: WorkerSavedObjectsAdmissionDependencies;

  constructor(dependencies: WorkerSavedObjectsAdmissionDependencies) {
    if (!dependencies.buildIdentity)
      throw new Error('Saved object admission requires a build identity');
    this.dependencies = { ...dependencies };
  }

  async create(typeNames: readonly string[]): Promise<WorkerSavedObjectsAdmission> {
    const names = [...typeNames];
    if (names.length === 0 || new Set(names).size !== names.length) {
      throw new Error('Saved object admission requires a non-empty unique type set');
    }
    const { buildIdentity, typeRegistry, getSourceDigest, assertMigrationsReady } =
      this.dependencies;
    await assertMigrationsReady();
    const types = names.map((name) => {
      const type = typeRegistry.getType(name);
      if (!type) {
        throw new Error(`Coordinator has no saved object type '${name}'`);
      }
      return Object.freeze(savedObjectsTypeParity(type, getSourceDigest(name)));
    });
    return Object.freeze({ buildIdentity, types: Object.freeze(types) });
  }

  async verify(admission: WorkerSavedObjectsAdmission): Promise<void> {
    // Snapshot before the migration check can yield to a closing lease or mutable caller.
    const approved = {
      buildIdentity: admission.buildIdentity,
      types: admission.types.map((type) => ({ ...type })),
    };
    if (approved.buildIdentity !== this.dependencies.buildIdentity) {
      throw new Error('Worker saved object build identity mismatch');
    }
    const current = await this.create(approved.types.map(({ name }) => name));
    assertSavedObjectsTypeParity(current.types, approved.types);
  }
}

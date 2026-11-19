/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { deepFreeze } from '@kbn/std';
import type {
  SavedObjectsClientFactoryProvider,
  SavedObjectsSecurityExtensionFactory,
  SavedObjectsSpacesExtensionFactory,
  SavedObjectsType,
  SavedObjectsServiceStart,
} from '@kbn/core-saved-objects-server';
import {
  SavedObjectsService,
  type InternalSavedObjectsServiceStart,
  type SavedObjectsSetupDeps,
  type SavedObjectsStartDeps,
  type SavedObjectsServiceDependencies,
} from './saved_objects_service';
import {
  resolveSavedObjectsType,
  savedObjectsTypeParity,
  type SavedObjectsTypeParity,
} from './saved_objects_type_parity';

export interface WorkerSavedObjectsType {
  readonly type: SavedObjectsType;
  /** Generated from the manifest-selected original type factory's source closure. */
  readonly sourceDigest: string;
}

export interface WorkerSavedObjectsAdmission {
  readonly buildIdentity: string;
  readonly types: readonly SavedObjectsTypeParity[];
}

export interface WorkerSavedObjectsOptions {
  readonly buildIdentity: string;
  readonly coreSourceDigest: string;
  readonly service: SavedObjectsServiceDependencies;
  readonly setup: Pick<SavedObjectsSetupDeps, 'elasticsearch'>;
  readonly start: SavedObjectsStartDeps;
  readonly clientFactory: SavedObjectsClientFactoryProvider;
  readonly security: SavedObjectsSecurityExtensionFactory;
  readonly spaces: SavedObjectsSpacesExtensionFactory;
  /** Verifies the coordinator's completed migration state for this lease, including cached types. */
  readonly verifyMigrations: (admission: WorkerSavedObjectsAdmission) => Promise<void>;
}

export interface WorkerSavedObjectsLease {
  readonly getClient: SavedObjectsServiceStart['getScopedClient'];
  release(): Promise<void>;
}

interface Generation {
  readonly service: SavedObjectsService;
  readonly start: InternalSavedObjectsServiceStart;
  readonly types: ReadonlyMap<string, WorkerSavedObjectsType>;
  readonly parity: readonly SavedObjectsTypeParity[];
  references: number;
}

const assertParity = (
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

/** Owns cumulative immutable registries; old in-flight leases never observe newly registered types. */
export class WorkerSavedObjects {
  private current?: Generation;
  private readonly retired = new Set<Generation>();
  private pending: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly options: WorkerSavedObjectsOptions) {
    if (!options.buildIdentity) throw new Error('Worker saved objects require a build identity');
  }

  acquire(
    types: readonly WorkerSavedObjectsType[],
    admission: WorkerSavedObjectsAdmission
  ): Promise<WorkerSavedObjectsLease> {
    const requestedTypes = [...types];
    const approved = Object.freeze({
      buildIdentity: admission.buildIdentity,
      types: Object.freeze(admission.types.map((type) => Object.freeze({ ...type }))),
    });
    // Serialize generation publication, not the work performed by already acquired clients.
    const result = this.pending.then(() => this.acquireGeneration(requestedTypes, approved));
    this.pending = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.pending;
    const current = this.current;
    this.current = undefined;
    if (current) this.retired.add(current);
    await Promise.all([...this.retired].map((generation) => this.disposeIfUnused(generation)));
  }

  private async acquireGeneration(
    types: readonly WorkerSavedObjectsType[],
    admission: WorkerSavedObjectsAdmission
  ): Promise<WorkerSavedObjectsLease> {
    if (this.stopped) throw new Error('Worker saved objects are stopped');
    if (admission.buildIdentity !== this.options.buildIdentity) {
      throw new Error('Worker saved object build identity mismatch');
    }
    const cumulative = new Map(this.current?.types);
    const names = new Set<string>();
    for (const { type, sourceDigest } of types) {
      if (names.has(type.name))
        throw new Error(`Duplicate worker saved object type '${type.name}'`);
      names.add(type.name);
      const resolved = resolveSavedObjectsType(type);
      const prior = cumulative.get(type.name);
      if (prior) {
        assertParity(
          [savedObjectsTypeParity(prior.type, prior.sourceDigest)],
          [savedObjectsTypeParity(resolved, sourceDigest)]
        );
      } else {
        cumulative.set(type.name, { type: resolved, sourceDigest });
      }
    }

    let generation = this.current;
    if (generation && cumulative.size === generation.types.size) {
      assertParity(generation.parity, admission.types);
      await this.options.verifyMigrations(admission);
    } else {
      generation = await this.createGeneration(cumulative, admission);
      const previous = this.current;
      this.current = generation;
      if (previous) {
        this.retired.add(previous);
        await this.disposeIfUnused(previous);
      }
    }
    generation.references++;
    let retained: Generation | undefined = generation;
    return {
      getClient: (request, options) => {
        if (!retained) throw new Error('Worker saved object lease is released');
        return retained.start.getScopedClient(request, options);
      },
      release: async () => {
        const released = retained;
        retained = undefined;
        if (!released) return;
        released.references--;
        await this.disposeIfUnused(released);
      },
    };
  }

  private async createGeneration(
    types: ReadonlyMap<string, WorkerSavedObjectsType>,
    admission: WorkerSavedObjectsAdmission
  ): Promise<Generation> {
    const service = new SavedObjectsService(this.options.service);
    try {
      const setup = await service.setupTask(this.options.setup);
      setup.setClientFactoryProvider(this.options.clientFactory);
      setup.setSecurityExtension(this.options.security);
      setup.setSpacesExtension(this.options.spaces);
      for (const { type } of types.values()) setup.registerType(type);
      const parity = setup
        .getTypeRegistry()
        .getAllTypes()
        .map((type) =>
          savedObjectsTypeParity(
            type,
            types.get(type.name)?.sourceDigest ?? this.options.coreSourceDigest
          )
        );
      assertParity(parity, admission.types);
      // Core's registry freezes only in development; retained worker generations must also be
      // immutable in production, including the resolved supplier results used by the migrator.
      setup
        .getTypeRegistry()
        .getAllTypes()
        .forEach((type) => deepFreeze(type));
      const start = await service.startTask(this.options.start, () =>
        this.options.verifyMigrations(admission)
      );
      return { service, start, types, parity, references: 0 };
    } catch (error) {
      await service.stop();
      throw error;
    }
  }

  private async disposeIfUnused(generation: Generation): Promise<void> {
    if (generation.references !== 0 || !this.retired.delete(generation)) return;
    await generation.service.stop();
  }
}

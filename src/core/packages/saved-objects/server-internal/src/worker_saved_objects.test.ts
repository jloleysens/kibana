/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { setImmediate } from 'node:timers/promises';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { loggerMock } from '@kbn/logging-mocks';
import { docLinksServiceMock } from '@kbn/core-doc-links-server-mocks';
import { nodeServiceMock } from '@kbn/core-node-server-mocks';
import { elasticsearchServiceMock } from '@kbn/core-elasticsearch-server-mocks';
import { httpServerMock } from '@kbn/core-http-server-mocks';
import {
  savedObjectsConfig,
  savedObjectsMigrationConfig,
  SavedObjectTypeRegistry,
} from '@kbn/core-saved-objects-base-server-internal';
import { KibanaMigrator } from '@kbn/core-saved-objects-migration-server-internal';
import { SavedObjectsClient } from '@kbn/core-saved-objects-api-server-internal';
import type { ISavedObjectTypeRegistry } from '@kbn/core-saved-objects-server';
import { registerCoreObjectTypes } from './object_types';
import { SavedObjectsService } from './saved_objects_service';
import { savedObjectsTypeParity } from './saved_objects_type_parity';
import {
  WorkerSavedObjects,
  type WorkerSavedObjectsOptions,
  type WorkerSavedObjectsType,
} from './worker_saved_objects';

const sourceDigest = 'a'.repeat(64);
const createType = (name: string): WorkerSavedObjectsType => ({
  sourceDigest,
  type: {
    name,
    hidden: false,
    namespaceType: 'single',
    mappings: { properties: { title: { type: 'keyword' } } },
  },
});
const admissionFor = (types: readonly WorkerSavedObjectsType[]) => {
  const registry = new SavedObjectTypeRegistry();
  registerCoreObjectTypes(registry);
  types.forEach(({ type }) => registry.registerType(type));
  return {
    buildIdentity: 'test-build',
    types: registry.getAllTypes().map((type) => savedObjectsTypeParity(type, sourceDigest)),
  };
};
const createOptions = (): WorkerSavedObjectsOptions => {
  return {
    buildIdentity: 'test-build',
    coreSourceDigest: sourceDigest,
    service: {
      logger: loggerMock.create(),
      kibanaVersion: '9.5.0',
      isServerless: false,
      readConfig: async () => ({
        savedObjects: savedObjectsConfig.schema.validate({}),
        migrations: savedObjectsMigrationConfig.schema.validate({ skip: false }),
      }),
    },
    setup: { elasticsearch: elasticsearchServiceMock.createInternalSetup() },
    start: {
      elasticsearch: elasticsearchServiceMock.createInternalStart(),
      docLinks: docLinksServiceMock.createStartContract(),
      node: nodeServiceMock.createInternalStartContract(),
    },
    security: jest.fn(() => undefined),
    spaces: jest.fn(() => undefined),
    clientFactory:
      (factory) =>
      ({ includedHiddenTypes, extensions }) =>
        new SavedObjectsClient(factory.createInternalRepository(includedHiddenTypes, extensions)),
    verifyMigrations: jest.fn(async () => undefined),
  };
};

describe('WorkerSavedObjects', () => {
  afterEach(() => jest.restoreAllMocks());

  it('builds cumulative registries without changing in-flight clients or starting index migrations', async () => {
    const options = createOptions();
    const migrations = jest.spyOn(KibanaMigrator.prototype, 'runMigrations');
    const stop = jest.spyOn(SavedObjectsService.prototype, 'stop');
    const worker = new WorkerSavedObjects(options);
    const firstType = createType('business-a');
    const secondType = createType('business-b');
    const first = await worker.acquire([firstType], admissionFor([firstType]));
    const second = await worker.acquire([secondType], admissionFor([firstType, secondType]));
    const request = httpServerMock.createKibanaRequest();
    expect(() => first.getClient(request, { includedHiddenTypes: ['business-b'] })).toThrow(
      'Missing mappings'
    );
    expect(() =>
      second.getClient(request, { includedHiddenTypes: ['business-a', 'business-b'] })
    ).not.toThrow();
    expect(stop).not.toHaveBeenCalled();
    await first.release();
    expect(stop).toHaveBeenCalledTimes(1);
    await first.release();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(() => first.getClient(request)).toThrow('released');
    await worker.stop();
    expect(stop).toHaveBeenCalledTimes(1);
    await second.release();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(migrations).not.toHaveBeenCalled();
  });

  it('constructs security and spaces extensions for each request, never caching run identity', async () => {
    const options = createOptions();
    const worker = new WorkerSavedObjects(options);
    const type = createType('business');
    const lease = await worker.acquire([type], admissionFor([type]));
    const requests = [
      httpServerMock.createKibanaRequest({ headers: { authorization: 'ApiKey first' } }),
      httpServerMock.createKibanaRequest({ headers: { authorization: 'ApiKey second' } }),
    ];
    requests.forEach((request) => lease.getClient(request));
    for (const extension of [options.security, options.spaces]) {
      expect(extension).toHaveBeenCalledTimes(2);
      requests.forEach((request, index) =>
        expect(extension).toHaveBeenNthCalledWith(index + 1, expect.objectContaining({ request }))
      );
    }
    await lease.release();
    await worker.stop();
  });

  it('revalidates migration readiness and parity on cached generation leases', async () => {
    const options = createOptions();
    const worker = new WorkerSavedObjects(options);
    const type = createType('business');
    const admission = admissionFor([type]);
    const first = await worker.acquire([type], admission);
    await first.release();
    const cached = await worker.acquire([], admission);
    await cached.release();
    expect(options.verifyMigrations).toHaveBeenCalledTimes(2);
    await expect(worker.acquire([], { ...admission, types: [] })).rejects.toThrow('type set');
    expect(options.verifyMigrations).toHaveBeenCalledTimes(2);
    await worker.stop();
  });

  it.each(['build', 'source', 'structure', 'missing', 'duplicate'] as const)(
    'fails closed on %s mismatch before client construction',
    async (mismatch) => {
      const options = createOptions();
      const worker = new WorkerSavedObjects(options);
      const type = createType('business');
      const admission = admissionFor([type]);
      const bad = {
        ...admission,
        buildIdentity: mismatch === 'build' ? 'stale-build' : admission.buildIdentity,
        types:
          mismatch === 'missing'
            ? []
            : mismatch === 'duplicate'
            ? [...admission.types, admission.types[0]]
            : admission.types.map((entry) => ({
                ...entry,
                sourceDigest: mismatch === 'source' ? 'b'.repeat(64) : entry.sourceDigest,
                structureDigest: mismatch === 'structure' ? 'b'.repeat(64) : entry.structureDigest,
              })),
      };
      await expect(worker.acquire([type], bad)).rejects.toThrow();
      expect(options.verifyMigrations).not.toHaveBeenCalled();
      expect(options.security).not.toHaveBeenCalled();
      const good = await worker.acquire([type], admission);
      await good.release();
      await worker.stop();
    }
  );

  it('does not publish a generation when migration verification fails; subsequent acquisition can retry', async () => {
    const options = createOptions();
    jest.mocked(options.verifyMigrations).mockRejectedValueOnce(new Error('Migration incomplete'));
    const worker = new WorkerSavedObjects(options);
    const type = createType('business');
    await expect(worker.acquire([type], admissionFor([type]))).rejects.toThrow(
      'Migration incomplete'
    );
    expect(options.security).not.toHaveBeenCalled();
    const lease = await worker.acquire([type], admissionFor([type]));
    await lease.release();
    await worker.stop();
  });

  it('snapshots lease admission before waiting for publication', async () => {
    const worker = new WorkerSavedObjects(createOptions());
    const type = createType('business');
    const admission = admissionFor([type]);
    const pending = worker.acquire([type], admission);
    admission.buildIdentity = 'stale-build';
    admission.types.length = 0;
    const lease = await pending;
    expect(() => lease.getClient(httpServerMock.createKibanaRequest())).not.toThrow();
    await lease.release();
    await worker.stop();
  });

  it('supports definition seeding without loading or executing any step handler', async () => {
    const setup = jest.spyOn(SavedObjectsService.prototype, 'setupTask');
    const types = Array.from({ length: 8 }, (_, index) => createType(`branch-${index}`));
    for (const seeded of [false, true]) {
      setup.mockClear();
      const worker = new WorkerSavedObjects(createOptions());
      for (let index = 0; index < types.length; index++) {
        const reached = types.slice(0, index + 1);
        const lease = await worker.acquire(
          seeded ? (index === 0 ? types : []) : [types[index]],
          admissionFor(seeded ? types : reached)
        );
        expect(() =>
          lease.getClient(httpServerMock.createKibanaRequest(), {
            includedHiddenTypes: reached.map(({ type }) => type.name),
          })
        ).not.toThrow();
        await lease.release();
      }
      expect(setup).toHaveBeenCalledTimes(seeded ? 1 : 8);
      await worker.stop();
    }
  });

  it('freezes registered storage definitions in production as well as development', async () => {
    const originalEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const worker = new WorkerSavedObjects(createOptions());
    try {
      const type = createType('business');
      const lease = await worker.acquire([type], admissionFor([type]));
      expect(Object.isFrozen(type.type.mappings.properties)).toBe(true);
      expect(() => {
        type.type.mappings.properties.title = { type: 'text' };
      }).toThrow();
      await lease.release();
    } finally {
      await worker.stop();
      process.env.NODE_ENV = originalEnvironment;
    }
  });

  it('rejects replacement and duplicate type definitions without changing the active registry', async () => {
    const worker = new WorkerSavedObjects(createOptions());
    const type = createType('business');
    const first = await worker.acquire([type], admissionFor([type]));
    const changed = { ...type, sourceDigest: 'b'.repeat(64) };
    await expect(worker.acquire([changed], admissionFor([type]))).rejects.toThrow(
      'parity mismatch'
    );
    await expect(worker.acquire([type, type], admissionFor([type]))).rejects.toThrow('Duplicate');
    expect(() => first.getClient(httpServerMock.createKibanaRequest())).not.toThrow();
    await first.release();
    await worker.stop();
  });

  it('serializes concurrent rebuilds without losing either type', async () => {
    const worker = new WorkerSavedObjects(createOptions());
    const firstType = createType('business-a');
    const secondType = createType('business-b');
    const [first, second] = await Promise.all([
      worker.acquire([firstType], admissionFor([firstType])),
      worker.acquire([secondType], admissionFor([firstType, secondType])),
    ]);
    expect(() =>
      second.getClient(httpServerMock.createKibanaRequest(), {
        includedHiddenTypes: ['business-a', 'business-b'],
      })
    ).not.toThrow();
    await Promise.all([first.release(), second.release()]);
    await worker.stop();
    await expect(worker.acquire([], admissionFor([]))).rejects.toThrow('stopped');
  });

  it('collects retired registries after repeated rebuilds, including retained released lease handles', async () => {
    // Obtain GC in an isolated VM so the test also runs under the ordinary Jest command.
    setFlagsFromString('--expose_gc');
    const gc = runInNewContext('gc') as () => void;
    setFlagsFromString('--no-expose_gc');
    const registries: Array<WeakRef<ISavedObjectTypeRegistry>> = [];
    const setup = SavedObjectsService.prototype.setupTask;
    jest
      .spyOn(SavedObjectsService.prototype, 'setupTask')
      .mockImplementation(async function (this: SavedObjectsService, deps) {
        const contract = await setup.call(this, deps);
        registries.push(new WeakRef(contract.getTypeRegistry()));
        return contract;
      });
    const worker = new WorkerSavedObjects(createOptions());
    const types: WorkerSavedObjectsType[] = [];
    const released = [];
    for (let index = 0; index < 40; index++) {
      const type = createType(`business-${index}`);
      types.push(type);
      const lease = await worker.acquire([type], admissionFor(types));
      await lease.release();
      released.push(lease);
    }
    // Jest otherwise retains the resolved setup contracts (and their registries) in mock.results.
    jest.mocked(SavedObjectsService.prototype.setupTask).mockClear();
    await setImmediate();
    gc();
    expect(registries.slice(0, -1).every((registry) => registry.deref() === undefined)).toBe(true);
    expect(registries[registries.length - 1].deref()).toBeDefined();
    await worker.stop();
    await setImmediate();
    gc();
    expect(registries.every((registry) => registry.deref() === undefined)).toBe(true);
    expect(released).toHaveLength(40);
  });
});

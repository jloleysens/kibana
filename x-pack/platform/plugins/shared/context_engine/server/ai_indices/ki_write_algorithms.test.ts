/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { resolve } from 'node:path';
import { build, stop } from 'esbuild';
import type { KiRevisionOperations } from './ki_write_algorithms';
import {
  updateKiWithRevisionOperations,
  softDeleteKiWithRevisionOperations,
  restoreKiWithRevisionOperations,
} from './ki_write_algorithms';
import { isKiDeleted as publicIsKiDeleted } from './ki_revision';
import { isKiDeleted } from './ki_revision_lifecycle';

const setup = (deleted = false) => {
  const revision = {
    index: 'ai-index-idx-orders',
    documentId: 'physical-ki',
    seqNo: 5,
    primaryTerm: 2,
    source: {
      id: 'ki',
      title: 'Old',
      tags: ['a', 'b'],
      governance: {
        lifecycle: { status: deleted ? ('deleted' as const) : ('active' as const) },
        provenance: { created_by: { uri: 'workflow://original', metadata: {} } },
      },
    },
  };
  const get = jest
    .fn<ReturnType<KiRevisionOperations['get']>, Parameters<KiRevisionOperations['get']>>()
    .mockResolvedValue(revision);
  const write = jest
    .fn<ReturnType<KiRevisionOperations['write']>, Parameters<KiRevisionOperations['write']>>()
    .mockResolvedValue({ result: 'updated' });
  const operations: KiRevisionOperations = { get, write };
  const options = {
    aiIndexId: 'orders',
    dest: { type: 'index' as const, value: 'ai-index-idx-orders' },
    kiId: 'ki',
    refresh: false,
    abortSignal: new AbortController().signal,
  };
  return { operations, options, revision, get, write };
};

it('preserves the original lifecycle predicate identity through the old revision export', () => {
  expect(publicIsKiDeleted).toBe(isKiDeleted);
});

it('runs the original update decision and forwards the exact revision without receiving writer authority', async () => {
  const { operations, options, revision, get, write } = setup();
  const ki = {
    title: 'New',
    governance: { provenance: { updated_by: { uri: 'workflow://forged', metadata: {} } } },
  };
  expect(await updateKiWithRevisionOperations({ ...options, ki }, operations)).toEqual({
    id: 'ki',
    result: 'updated',
  });
  expect(get).toHaveBeenCalledWith({
    aiIndexId: options.aiIndexId,
    dest: options.dest,
    kiId: options.kiId,
    abortSignal: options.abortSignal,
    backingIndex: undefined,
    includeSource: true,
  });
  expect(write).toHaveBeenCalledWith({
    ...options,
    revision,
    changes: { title: 'New', updated_at: expect.any(String), governance: {} },
  });
  expect(write.mock.calls[0][0].revision).toBe(revision);
  expect(revision.source.governance.provenance.created_by.uri).toBe('workflow://original');
});

it('preserves original array comparison, noop and deleted-KI guard decisions', async () => {
  const { operations, options, write } = setup();
  expect(
    await updateKiWithRevisionOperations({ ...options, ki: { tags: ['a', 'b'] } }, operations)
  ).toEqual({ id: 'ki', result: 'noop' });
  expect(write).not.toHaveBeenCalled();
  await updateKiWithRevisionOperations({ ...options, ki: { tags: ['a'] } }, operations);
  expect(write).toHaveBeenCalledTimes(1);
  const deleted = setup(true);
  await expect(
    updateKiWithRevisionOperations({ ...deleted.options, ki: {} }, deleted.operations)
  ).rejects.toThrow('restore the deleted KI');
  expect(deleted.write).not.toHaveBeenCalled();
  await updateKiWithRevisionOperations(
    { ...deleted.options, ki: { title: 'Forced' }, force: true },
    deleted.operations
  );
  expect(deleted.write).toHaveBeenCalledTimes(1);
});

it.each([
  { deleted: false, operation: softDeleteKiWithRevisionOperations, status: 'deleted' },
  { deleted: true, operation: restoreKiWithRevisionOperations, status: 'active' },
])(
  'keeps the original $status lifecycle transition and idempotence',
  async ({ deleted, operation, status }) => {
    const { operations, options, revision, write } = setup(deleted);
    expect(await operation(options, operations)).toEqual({ id: 'ki' });
    expect(write).toHaveBeenCalledWith({
      ...options,
      revision,
      changes: { updated_at: expect.any(String), governance: { lifecycle: { status } } },
    });
    const unchanged = setup(!deleted);
    expect(await operation(unchanged.options, unchanged.operations)).toEqual({ id: 'ki' });
    expect(unchanged.write).not.toHaveBeenCalled();
  }
);

it('propagates final revision failures unchanged for the original handler error and telemetry policies', async () => {
  const { operations, options, write } = setup();
  const failure = new TypeError('Final commit failed');
  write.mockRejectedValue(failure);
  await expect(
    updateKiWithRevisionOperations({ ...options, ki: { title: 'New' } }, operations)
  ).rejects.toBe(failure);
});

it('has a bounded pure algorithm closure, without the revision ES adapter or authoring schemas', async () => {
  const bundle = await build({
    entryPoints: [resolve(__dirname, 'ki_write_algorithms.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    metafile: true,
    write: false,
  });
  expect(
    Object.keys(bundle.metafile.inputs).filter((path) =>
      /\/ki_revision\.ts$|\/common\/step_types\/ki\.ts$|node_modules\/(?:@elastic\/(?:elasticsearch|eui)|react(?:-dom)?|@emotion)\/|node_modules\/lodash\/(?:lodash|index)\.js$/.test(
        path
      )
    )
  ).toEqual([]);
  expect(bundle.outputFiles[0].contents.byteLength).toBeLessThan(256 * 1024);
});

afterAll(() => stop());

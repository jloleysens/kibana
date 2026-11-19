/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { digestRemoteSources, verifyRemoteSourceDigest } from './source_digest';
import type { RemoteContributionSourceDigest } from './source_digest';

it('normalizes source order, portable paths and line endings without evaluating code', () => {
  const coordinator = [
    { path: 'plugin/types.ts', source: "throw new Error('never load');\n" },
    { path: 'plugin/model.ts', source: 'export const version = 2;\n' },
  ];
  const worker = [
    { path: 'plugin\\model.ts', source: 'export const version = 2;\r\n' },
    { path: 'plugin\\types.ts', source: "throw new Error('never load');\r\n" },
  ];
  expect(digestRemoteSources(coordinator)).toMatch(/^[a-f0-9]{64}$/);
  expect(digestRemoteSources(worker)).toBe(digestRemoteSources(coordinator));
});

it('detects source bytes, file names, missing sources and boundary changes', () => {
  const original = digestRemoteSources([{ path: 'a.ts', source: 'bc' }]);
  for (const files of [
    [{ path: 'a.ts', source: 'bd' }],
    [{ path: 'ab.ts', source: 'c' }],
    [
      { path: 'a.ts', source: 'bc' },
      { path: 'b.ts', source: '' },
    ],
  ]) {
    expect(digestRemoteSources(files)).not.toBe(original);
  }
});

it.each(['', '/absolute.ts', '../parent.ts', 'a/../b.ts', './a.ts', 'a//b.ts', 'C:\\source.ts'])(
  'refuses noncanonical source path %j',
  (path) => {
    expect(() => digestRemoteSources([{ path, source: '' }])).toThrow('repository-relative');
  }
);

it('refuses empty and duplicate closures', () => {
  expect(() => digestRemoteSources([])).toThrow('at least one');
  expect(() =>
    digestRemoteSources([
      { path: 'a/b.ts', source: 'one' },
      { path: 'a\\b.ts', source: 'two' },
    ])
  ).toThrow('duplicate');
});

const sourceMetadata = (): RemoteContributionSourceDigest => ({
  kindId: 'core.savedObjects.types',
  contributionId: 'example',
  modulePath: 'types.ts',
  exportName: 'createTypes',
  sources: ['types.ts', 'deferred.ts'],
  digest: digestRemoteSources([
    { path: 'types.ts', source: 'original' },
    { path: 'deferred.ts', source: 'deferred' },
  ]),
});

it('verifies the coordinator original source closure with the worker canonical hash', () => {
  const readSource = jest.fn((path: string) => (path === 'types.ts' ? 'original' : 'deferred'));
  expect(verifyRemoteSourceDigest(sourceMetadata(), readSource)).toBe(sourceMetadata().digest);
  expect(readSource.mock.calls).toEqual([['types.ts'], ['deferred.ts']]);
  expect(() => verifyRemoteSourceDigest(sourceMetadata(), () => 'stale')).toThrow(
    'source mismatch'
  );
});

it.each([
  { sources: ['types.ts', '../outside.ts'] },
  { sources: ['types.ts', 'types.ts'] },
  { sources: [] },
  { sources: ['deferred.ts'] },
  { modulePath: '/outside.ts' },
  { digest: 'unverified' },
])('refuses invalid generated metadata before reading any sources: %j', (invalid) => {
  const readSource = jest.fn();
  expect(() => verifyRemoteSourceDigest({ ...sourceMetadata(), ...invalid }, readSource)).toThrow();
  expect(readSource).not.toHaveBeenCalled();
});

it('propagates missing-source errors without returning a usable digest', () => {
  expect(() =>
    verifyRemoteSourceDigest(sourceMetadata(), () => {
      throw new Error('Missing source');
    })
  ).toThrow('Missing source');
});

it('snapshots the expected digest before the source reader runs', () => {
  const metadata = { ...sourceMetadata() };
  expect(() =>
    verifyRemoteSourceDigest(metadata, () => {
      metadata.digest = digestRemoteSources([
        { path: 'types.ts', source: 'stale' },
        { path: 'deferred.ts', source: 'stale' },
      ]);
      return 'stale';
    })
  ).toThrow('source mismatch');
});

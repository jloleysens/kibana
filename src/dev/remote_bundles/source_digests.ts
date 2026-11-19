/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { relative, resolve, sep } from 'node:path';
import type { Metafile } from 'esbuild';
import { digestRemoteSources } from '@kbn/core-remote-common';
import type { RemoteContributionSourceDigest } from '@kbn/core-remote-common';
export type { RemoteContributionSourceDigest } from '@kbn/core-remote-common';

interface ContributionSource {
  readonly kind: string;
  readonly stepType: string;
  readonly modulePath: string;
  readonly exportName: string;
}

/** Describes original static and deferred source closures without importing any contributed implementation. */
export const collectRemoteSourceDigests = (
  metafile: Metafile,
  contributions: readonly ContributionSource[],
  root: string = process.cwd()
): RemoteContributionSourceDigest[] => {
  const inputs = new Map(
    Object.entries(metafile.inputs).map(([path, input]) => [resolve(root, path), input])
  );
  const sourcePath = (path: string): string => {
    const name = relative(root, path).split(sep).join('/');
    if (name.startsWith('../') || !name || name === '..') {
      throw new Error('Remote source closure must stay within the repository');
    }
    return name;
  };
  return contributions.map(({ kind, stepType, modulePath, exportName }) => {
    const visited = new Set<string>();
    const visit = (path: string): void => {
      if (visited.has(path)) return;
      const input = inputs.get(path);
      if (!input) throw new Error(`Missing remote source input: ${sourcePath(path)}`);
      visited.add(path);
      for (const dependency of input.imports) {
        if (dependency.external) {
          // esbuild's helper runtime has no original source file; it is covered by build identity.
          if (!isBuiltin(dependency.path) && dependency.path !== '<runtime>') {
            throw new Error(`Unverifiable external remote source: ${dependency.path}`);
          }
          continue;
        }
        visit(resolve(root, dependency.path));
      }
    };
    visit(resolve(root, modulePath));
    const sources = [...visited].map(sourcePath).sort();
    const digest = digestRemoteSources(
      sources.map((path) => ({ path, source: readFileSync(resolve(root, path), 'utf8') }))
    );
    return {
      kindId: kind,
      contributionId: stepType,
      modulePath: sourcePath(resolve(root, modulePath)),
      exportName,
      digest,
      sources,
    };
  });
};

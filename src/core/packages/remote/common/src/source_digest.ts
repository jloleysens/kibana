/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { createHash } from 'node:crypto';

export interface RemoteSourceFile {
  readonly path: string;
  readonly source: string;
}

/** Hashes original source content independently of checkout location, line endings and transpilation. */
export const digestRemoteSources = (files: readonly RemoteSourceFile[]): string => {
  if (files.length === 0) throw new Error('Remote source digest requires at least one source');
  const normalized = files.map(({ path, source }) => {
    const portablePath = path.replace(/\\/g, '/');
    if (
      !portablePath ||
      portablePath.startsWith('/') ||
      /^[a-z]:/i.test(portablePath) ||
      portablePath.split('/').some((part) => part === '..' || part === '.' || part === '')
    ) {
      throw new Error('Remote source digest requires canonical repository-relative paths');
    }
    return { path: portablePath, source: source.replace(/\r\n?/g, '\n') };
  });
  normalized.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  if (new Set(normalized.map(({ path }) => path)).size !== normalized.length) {
    throw new Error('Remote source digest contains duplicate paths');
  }
  const hash = createHash('sha256');
  hash.update('kibana-remote-source-v1\n');
  for (const { path, source } of normalized) {
    hash.update(`${Buffer.byteLength(path)}:${path}${Buffer.byteLength(source)}:`);
    hash.update(source);
  }
  return hash.digest('hex');
};

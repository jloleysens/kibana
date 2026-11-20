/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getPackages } from '@kbn/repo-packages';

/** Discovers declaration entries from package metadata, without importing plugin entry points. */
export const discoverRemoteManifests = (repoRoot: string): string[] =>
  getPackages(repoRoot)
    .map(({ directory }) => join(directory, 'server/remote/index.ts'))
    .filter(existsSync)
    .sort();

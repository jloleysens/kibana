/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Metafile } from 'esbuild';

export interface StepChunkSize {
  readonly stepType: string;
  readonly modulePath: string;
  readonly entryBytes: number;
  readonly exclusiveBytes: number;
  readonly sharedBytes: number;
}

/** Measures static import closures, charging chunks shared by entry points separately from steps. */
export const measureStepChunks = (
  metafile: Metafile,
  contributions: ReadonlyArray<{ readonly stepType: string; readonly modulePath: string }>
): StepChunkSize[] => {
  const canonical = (file: string): string =>
    existsSync(file) ? realpathSync(file) : resolve(file);
  const closures = new Map<string, Set<string>>();
  const owners = new Map<string, Set<string>>();
  const entries = new Map<string, string>();
  for (const [file, output] of Object.entries(metafile.outputs)) {
    if (!output.entryPoint) continue;
    const entry = canonical(output.entryPoint);
    entries.set(entry, file);
    const closure = new Set<string>();
    const visit = (chunk: string): void => {
      if (closure.has(chunk)) return;
      const dependency = metafile.outputs[chunk];
      if (!dependency) throw new Error(`Missing bundled static dependency: ${chunk}`);
      closure.add(chunk);
      for (const imported of dependency.imports) {
        if (!imported.external && imported.kind !== 'dynamic-import') visit(imported.path);
      }
    };
    visit(file);
    closures.set(entry, closure);
    for (const chunk of closure) {
      const users = owners.get(chunk) ?? new Set<string>();
      users.add(entry);
      owners.set(chunk, users);
    }
  }
  return contributions.map(({ stepType, modulePath }) => {
    const entry = canonical(modulePath);
    const file = entries.get(entry);
    const closure = closures.get(entry);
    if (!file || !closure) throw new Error(`Missing bundled step entry: ${stepType} (${entry})`);
    let exclusiveBytes = 0;
    let sharedBytes = 0;
    for (const chunk of closure) {
      const bytes = metafile.outputs[chunk].bytes;
      if (owners.get(chunk)?.size === 1) exclusiveBytes += bytes;
      else sharedBytes += bytes;
    }
    return {
      stepType,
      modulePath,
      entryBytes: metafile.outputs[file].bytes,
      exclusiveBytes,
      sharedBytes,
    };
  });
};

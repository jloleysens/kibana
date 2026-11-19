/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { resolve } from 'node:path';
import type { Metafile } from 'esbuild';
import type { RemoteWorkerSpec } from '@kbn/core-remote-common';

/** Measures a shell's exclusive inputs independently of esbuild's shared-chunk repartition. */
export const measureShellInputs = (metadata: Metafile, spec: RemoteWorkerSpec, tokenId: string) => {
  const shell = spec.executorProviders.find((provider) => provider.tokenId === tokenId);
  if (!shell) throw new Error(`Missing executor shell: ${tokenId}`);
  const entries = new Map(
    Object.entries(metadata.outputs).flatMap(([file, output]) =>
      output.entryPoint ? [[resolve(output.entryPoint), file] as const] : []
    )
  );
  const closure = (modules: string[]): Set<string> => {
    const files = new Set<string>();
    const visit = (file: string) => {
      if (files.has(file)) return;
      const output = metadata.outputs[file];
      if (!output) throw new Error(`Missing shell dependency: ${file}`);
      files.add(file);
      for (const imported of output.imports)
        if (!imported.external && imported.kind !== 'dynamic-import') visit(imported.path);
    };
    for (const modulePath of modules) {
      const entry = entries.get(resolve(modulePath));
      if (!entry) throw new Error(`Missing shell entry: ${modulePath}`);
      visit(entry);
    }
    return files;
  };
  const core = closure(
    [
      spec.root,
      ...spec.executorProviders.filter((provider) => provider !== shell),
      ...(spec.catalog ? [spec.catalog] : []),
    ].map(({ modulePath }) => modulePath)
  );
  const exclusive = [...closure([shell.modulePath])].filter((file) => !core.has(file));
  const inputs = [
    ...new Set(
      exclusive.flatMap((file) =>
        Object.entries(metadata.outputs[file].inputs)
          .filter(([, input]) => input.bytesInOutput > 0)
          .map(([path]) => path)
      )
    ),
  ].sort();
  return {
    inputs,
    inputBytes: inputs.reduce((bytes, path) => {
      const input = metadata.inputs[path];
      if (!input) throw new Error(`Missing shell input: ${path}`);
      return bytes + input.bytes;
    }, 0),
    emittedBytes: exclusive.reduce((bytes, file) => bytes + metadata.outputs[file].bytes, 0),
  };
};

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import { getJsSourceSync } from '@kbn/peggy';
import type { RemoteContributionSourceDigest, RemoteWorkerSpec } from '@kbn/core-remote-common';
import { readRemoteManifest } from './manifest';
import { measureStepChunks, type StepChunkSize } from './step_chunk_sizes';
import { collectRemoteSourceDigests } from './source_digests';

const MAX_STEP_EXCLUSIVE_BYTES = 256 * 1024;

export interface RemoteBundle {
  readonly entry: string;
  readonly bytes: number;
  readonly reportingCeilingBytes?: number;
  readonly exceedsReportingCeiling?: boolean;
  readonly inputs: readonly string[];
  readonly spec: RemoteWorkerSpec;
  readonly stepChunks: readonly StepChunkSize[];
  readonly sourceDigests: readonly RemoteContributionSourceDigest[];
}

export interface BundleGraph {
  readonly id: string;
  readonly root: string;
  readonly dependencies: readonly string[];
  readonly contributions: readonly string[];
}

/** Builds a placement-selected graph with one dynamic import boundary per implementation. */
export const buildRemoteBundle = async ({
  manifests,
  graph,
  outdir,
  sourceDigestKinds = [],
  reportingCeilingBytes,
}: {
  manifests: readonly string[];
  graph: BundleGraph;
  outdir: string;
  sourceDigestKinds?: readonly string[];
  reportingCeilingBytes?: number;
}): Promise<RemoteBundle> => {
  if (
    reportingCeilingBytes !== undefined &&
    (!Number.isSafeInteger(reportingCeilingBytes) || reportingCeilingBytes <= 0)
  ) {
    throw new Error('Remote bundle reporting ceiling must be a positive safe integer');
  }
  for (const kind of sourceDigestKinds) {
    if (!graph.contributions.includes(kind)) {
      throw new Error(`Source-digested contribution kind is not selected by graph: ${kind}`);
    }
  }
  const declarations = manifests.map(readRemoteManifest);
  const providers = declarations.flatMap((declaration) => declaration.providers);
  const relevant = declarations.filter(
    (declaration) =>
      declaration.providers.some(
        ({ token }) => token === graph.root || graph.dependencies.includes(token)
      ) || declaration.contributions.some(({ kind }) => graph.contributions.includes(kind))
  );
  const selected = relevant
    .flatMap((declaration) => declaration.providers)
    .filter(({ token, role }) =>
      role === 'root'
        ? token === graph.root
        : role === 'catalog'
        ? graph.dependencies.includes(token)
        : true
    );
  for (const token of [graph.root, ...graph.dependencies]) {
    if (selected.filter((provider) => provider.token === token).length !== 1) {
      throw new Error(`Graph ${graph.id} requires exactly one provider for ${token}`);
    }
  }
  const root = selected.find(({ token }) => token === graph.root);
  if (!root || root.role !== 'root' || root.placement !== 'executor') {
    throw new Error(`Graph ${graph.id} requires an executor root`);
  }
  const reference = (provider: (typeof selected)[number]) => ({
    tokenId: provider.token,
    modulePath: provider.modulePath,
    exportName: provider.exportName,
  });
  const catalogs = selected.filter(({ role }) => role === 'catalog');
  if (catalogs.length > 1 || catalogs.some(({ placement }) => placement !== 'executor')) {
    throw new Error(`Graph ${graph.id} requires at most one executor catalog`);
  }
  const contributions = declarations
    .flatMap((declaration) => declaration.contributions)
    .filter(({ kind }) => graph.contributions.includes(kind));
  if (new Set(contributions.map(({ stepType }) => stepType)).size !== contributions.length) {
    throw new Error(`Graph ${graph.id} has duplicate step types`);
  }
  const spec: RemoteWorkerSpec = {
    id: graph.id,
    root: reference(root),
    catalog: catalogs[0] ? reference(catalogs[0]) : undefined,
    executorProviders: selected
      .filter(({ placement, role }) => placement === 'executor' && (!role || role === 'default'))
      .map(reference),
    coordinatorTokenIds: selected
      .filter(({ placement }) => placement === 'coordinator')
      .map(({ token }) => token),
    contributions: contributions.map(({ kind, stepType, modulePath, exportName }) => ({
      kindId: kind,
      stepType,
      modulePath,
      exportName,
    })),
  };
  const implementations = new Set(
    [
      spec.root,
      ...(spec.catalog ? [spec.catalog] : []),
      ...spec.executorProviders,
      ...contributions,
    ].map(({ modulePath }) => modulePath)
  );
  const host = resolve('src/core/packages/remote/server-internal/src/remote_process_entry.ts');
  const entry = `import { serveProcess } from ${JSON.stringify(host)};
    export const spec = ${JSON.stringify(spec)};
    export const implementations = {
      ${[...implementations]
        .map((path) => `${JSON.stringify(path)}: () => import(${JSON.stringify(path)})`)
        .join(',\n')}
    };
    if (process.send) serveProcess(spec, implementations);`;
  mkdirSync(outdir, { recursive: true });
  const result = await build({
    stdin: { contents: entry, resolveDir: process.cwd(), sourcefile: `${graph.id}.ts` },
    outdir,
    entryNames: 'graph',
    chunkNames: '[name]-[hash]',
    outExtension: { '.js': '.mjs' },
    bundle: true,
    splitting: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    metafile: true,
    write: false,
    charset: 'ascii',
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
    plugins: [
      {
        name: 'peggy',
        setup(bundler) {
          bundler.onLoad({ filter: /\.peggy$/ }, ({ path }) => ({
            contents: getJsSourceSync({
              path,
              content: readFileSync(path, 'utf8'),
              format: 'commonjs',
            }).source,
            loader: 'js',
          }));
        },
      },
    ],
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  });
  const canonical = (path: string): string =>
    existsSync(path) ? realpathSync(path) : resolve(path);
  const coordinatorFiles = new Set(
    providers
      .filter(({ placement }) => placement === 'coordinator')
      .map(({ modulePath }) => canonical(modulePath))
  );
  const forbidden = Object.keys(result.metafile.inputs).filter(
    (path) =>
      coordinatorFiles.has(canonical(path)) ||
      /node_modules\/(?:@elastic\/(?:eui|charts)|@emotion\/|react(?:-dom)?\/|lodash(?:-es)?\/(?:lodash|fp)\.js|lodash\/fp\/index\.js)/.test(
        path
      )
  );
  writeFileSync(join(outdir, 'metafile.json'), JSON.stringify(result.metafile, null, 2));
  writeFileSync(join(outdir, 'forbidden_inputs.json'), JSON.stringify(forbidden, null, 2));
  if (forbidden.length) throw new Error(`Forbidden worker inputs:\n${forbidden.join('\n')}`);
  const stepChunks = measureStepChunks(result.metafile, contributions);
  writeFileSync(join(outdir, 'step_chunks.json'), JSON.stringify(stepChunks, null, 2));
  const oversized = stepChunks.filter(
    ({ exclusiveBytes }) => exclusiveBytes > MAX_STEP_EXCLUSIVE_BYTES
  );
  if (oversized.length) {
    throw new Error(
      `Worker step exclusive chunks exceed ${MAX_STEP_EXCLUSIVE_BYTES} bytes:\n${oversized
        .map(({ stepType, exclusiveBytes }) => `${stepType}: ${exclusiveBytes}`)
        .join('\n')}`
    );
  }
  const sourceDigests = collectRemoteSourceDigests(
    result.metafile,
    contributions.filter(({ kind }) => sourceDigestKinds.includes(kind))
  );
  writeFileSync(join(outdir, 'source_digests.json'), JSON.stringify(sourceDigests, null, 2));
  const bytes = result.outputFiles.reduce((sum, output) => sum + output.contents.length, 0);
  const sizeReport = {
    bytes,
    reportingCeilingBytes,
    exceedsReportingCeiling:
      reportingCeilingBytes === undefined ? undefined : bytes > reportingCeilingBytes,
  };
  writeFileSync(join(outdir, 'bundle_size.json'), JSON.stringify(sizeReport, null, 2));
  for (const output of result.outputFiles) writeFileSync(output.path, output.contents);
  writeFileSync(join(outdir, 'spec.json'), JSON.stringify(spec, null, 2));
  return {
    entry: join(outdir, 'graph.mjs'),
    ...sizeReport,
    inputs: Object.keys(result.metafile.inputs).map((path) =>
      relative(process.cwd(), resolve(path))
    ),
    spec,
    stepChunks,
    sourceDigests,
  };
};

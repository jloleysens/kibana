/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildRemoteBundle } from './build';

const manifest = resolve(
  __dirname,
  '../../core/packages/remote/server-internal/src/__fixtures__/demo_plugin/server/remote/index.ts'
);
const graph = {
  id: 'demo',
  root: 'demo.root',
  dependencies: ['demo.echo', 'demo.catalog'],
  contributions: ['demo.step'],
};

it('bundles executor implementations only; importing its entry evaluates no implementations', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-bundle-'));
  try {
    const result = await buildRemoteBundle({ manifests: [manifest], graph, outdir: directory });
    expect(result.inputs.some((path) => path.endsWith('/echo.ts'))).toBe(false);
    expect(result.inputs.some((path) => path.endsWith('/step.ts'))).toBe(true);
    expect(result.spec.coordinatorTokenIds).toEqual(['demo.echo']);
    const entry = readFileSync(result.entry, 'utf8');
    expect(entry).toContain('() => import(');
    expect(entry).not.toContain('class EchoStep');
    const script = `
      const graph = await import(${JSON.stringify(result.entry)});
      const rootModule = await graph.implementations[graph.spec.root.modulePath]();
      if (!rootModule.Root) throw new Error('Missing root');
      process.stdout.write(JSON.stringify(graph.spec.coordinatorTokenIds));
    `;
    expect(
      execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
    ).toBe('["demo.echo"]');
  } finally {
    rmSync(directory, { recursive: true });
  }
});

it('rejects unresolved graph dependencies instead of silently omitting them', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-bundle-'));
  try {
    await expect(
      buildRemoteBundle({
        manifests: [manifest],
        graph: { ...graph, dependencies: ['missing'] },
        outdir: directory,
      })
    ).rejects.toThrow('exactly one provider for missing');
  } finally {
    rmSync(directory, { recursive: true });
  }
});

it('fails closed when an executor imports a coordinator implementation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-placement-'));
  try {
    const coordinator = join(directory, 'coordinator.ts');
    writeFileSync(coordinator, 'export const secret = Date.now();');
    writeFileSync(join(directory, 'root.ts'), `export { secret as Root } from './coordinator';`);
    const declaration = join(directory, 'index.ts');
    writeFileSync(
      declaration,
      `export const remoteModule = { providers: [
      {token:'root',role:'root',placement:'executor',modulePath:require.resolve('./root.ts'),exportName:'Root'},
      {token:'secret',placement:'coordinator',modulePath:require.resolve('./coordinator.ts'),exportName:'secret'}
    ] };`
    );
    await expect(
      buildRemoteBundle({
        manifests: [declaration],
        graph: { id: 'leak', root: 'root', dependencies: ['secret'], contributions: [] },
        outdir: directory,
      })
    ).rejects.toThrow('Forbidden worker inputs');
  } finally {
    rmSync(directory, { recursive: true });
  }
});

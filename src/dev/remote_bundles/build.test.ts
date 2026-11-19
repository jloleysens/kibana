/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { execFileSync, fork } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { graphSignature } from '@kbn/core-remote-server-internal/src/graph_signature';
import { openIpcSession } from '@kbn/core-remote-server-internal/src/ipc_session';
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
    const result = await buildRemoteBundle({
      manifests: [manifest],
      graph,
      outdir: directory,
      sourceDigestKinds: ['demo.step'],
      reportingCeilingBytes: 1,
    });
    expect(result.exceedsReportingCeiling).toBe(true);
    expect(result.reportingCeilingBytes).toBe(1);
    const sourceDigests = JSON.parse(readFileSync(join(directory, 'source_digests.json'), 'utf8'));
    expect(sourceDigests).toEqual([
      expect.objectContaining({
        kindId: 'demo.step',
        contributionId: 'demo.echoStep',
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        sources: expect.arrayContaining([expect.stringMatching(/\/step.ts$/)]),
      }),
    ]);
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

it('disconnect aborts active work, closes its data capability and forces exit despite live timers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-disconnect-'));
  const effects = join(directory, 'writes');
  const spec = {
    id: 'disconnect',
    root: { tokenId: 'root', modulePath: 'root', exportName: 'Root' },
    executorProviders: [],
    coordinatorTokenIds: [],
    contributions: [],
  };
  const entry = join(directory, 'graph.cjs');
  await build({
    stdin: {
      contents: `
      import { appendFileSync } from 'node:fs';
      import { serveProcess } from ${JSON.stringify(
        resolve(__dirname, '../../core/packages/remote/server-internal/src/remote_process_entry.ts')
      )};
      class Root {
        controller = new AbortController();
        closed = false;
        async run() {
          setInterval(() => { if (!this.closed) appendFileSync(${JSON.stringify(
            effects
          )}, 'write\\n'); }, 20);
          process.send({ kind: 'running' });
          await new Promise(resolve => this.controller.signal.addEventListener('abort', resolve, { once: true }));
          appendFileSync(${JSON.stringify(effects)}, 'aborted\\n');
          await new Promise(() => {});
        }
        async [Symbol.asyncDispose]() { this.controller.abort(); this.closed = true; }
      }
      serveProcess(${JSON.stringify(spec)}, { root: async () => ({ Root }) });
    `,
      resolveDir: process.cwd(),
    },
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
  });
  const child = fork(entry, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const session = openIpcSession<{ run(): Promise<void> }>(child);
  const message = (kind: string) =>
    new Promise<void>((resolveMessage) => {
      const listener = (value: { kind?: string }) => {
        if (value.kind === kind) {
          child.off('message', listener);
          resolveMessage();
        }
      };
      child.on('message', listener);
    });
  try {
    const ready = message('ready');
    child.send({ kind: 'init', signature: graphSignature(spec) });
    await ready;
    const running = message('running');
    void session.remote.run().catch(() => undefined);
    await running;
    await delay(80);
    const exited = once(child, 'exit');
    const timeout = setTimeout(() => child.kill(), 2000);
    const disconnectedAt = Date.now();
    child.disconnect();
    await exited;
    clearTimeout(timeout);
    expect(Date.now() - disconnectedAt).toBeLessThan(2000);
    expect(child.exitCode).toBe(0);
    const writes = readFileSync(effects, 'utf8');
    expect(writes).toContain('write');
    expect(writes).toContain('aborted');
    expect(writes.slice(writes.indexOf('aborted'))).not.toContain('write');
    await delay(100);
    expect(readFileSync(effects, 'utf8')).toBe(writes);
  } finally {
    session.close();
    if (child.exitCode === null) child.kill();
    rmSync(directory, { recursive: true });
  }
}, 10000);

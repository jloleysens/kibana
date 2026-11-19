/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import * as childProcess from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createToken } from '@kbn/core-di';
import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { RemoteService } from '@kbn/core-remote-server-internal';
import { buildRemoteBundle } from './build';

const plugin = resolve(
  __dirname,
  '../../core/packages/remote/server-internal/src/__fixtures__/demo_plugin'
);

class CoordinatorEcho {
  where(): { marker: string; isMainThread: boolean; threadId: number } {
    return { marker: 'coordinator', isMainThread: true, threadId: 0 };
  }
}

interface DemoApi {
  pid(): Promise<number>;
  bindingLabel(): Promise<string>;
  hasDispatchEnvironment(): Promise<boolean>;
  copy(value: { marker: string }): Promise<{ marker: string }>;
  loadedModules(): Promise<string[]>;
  run(request: { scopeId: string; steps: Array<{ type: string }> }): Promise<{
    outputs: Array<{ marker: string }>;
  }>;
}

it.each(['in_process', 'child_process'] as const)(
  '%s: same graph, serialized RPC, step implementation absent until first reach and cached thereafter',
  async (backend) => {
    const directory = mkdtempSync(join(tmpdir(), 'runner-backends-'));
    const previousHeaders = process.env.KBN_RUNNER_INTERNAL_HEADERS;
    process.env.KBN_RUNNER_INTERNAL_HEADERS = 'parent-only-test-credential';
    const service = new RemoteService(loggingSystemMock.createLogger(), {
      maxOldGenerationSizeMb: 256,
      bundleDirectory: directory,
    });
    try {
      await buildRemoteBundle({
        manifests: [join(plugin, 'server/remote/index.ts')],
        graph: {
          id: 'demo',
          root: 'demo.root',
          dependencies: ['demo.catalog'],
          contributions: ['demo.step'],
        },
        outdir: join(directory, 'demo'),
      });
      service.discover([plugin]);
      service.register({
        id: 'demo',
        reuse: { maxAgeMs: 60_000, maxRuns: 2 },
        root: createToken('demo.root'),
        dependencies: [createToken('demo.catalog')],
        contributions: [createToken('demo.step')],
      });
      service.bind(createToken('demo.echo'), () => new CoordinatorEcho());
      service.bindInProcess(createToken('demo.value'), () => ({ label: () => 'core' }));
      service.bindInProcess(createToken('unrelated.graph'), () => {
        throw new Error('Unrelated graph binding must not materialize');
      });
      await service.start(backend);
      const session = await service.whenReady<DemoApi>('demo');
      expect(await session.stub.bindingLabel()).toBe(
        backend === 'in_process' ? 'core' : 'executor'
      );
      const pid = await session.stub.pid();
      expect(pid === process.pid).toBe(backend === 'in_process');
      expect(await session.stub.hasDispatchEnvironment()).toBe(backend === 'in_process');
      const original = { marker: 'copy me' };
      expect(await session.stub.copy(original)).toEqual(original);
      expect(await session.stub.copy(original)).not.toBe(original);
      const initial = await session.stub.loadedModules();
      expect(initial.some((path) => path.endsWith('/executor_value.ts'))).toBe(
        backend === 'child_process'
      );
      expect(initial.some((path) => path.endsWith('/step.ts'))).toBe(false);
      const scopeId = session.openScope({});
      expect((await session.stub.run({ scopeId, steps: [] })).outputs).toEqual([]);
      expect(await session.stub.loadedModules()).toEqual(initial);
      const run = () => session.stub.run({ scopeId, steps: [{ type: 'demo.echoStep' }] });
      expect((await run()).outputs).toEqual([{ marker: 'coordinator' }]);
      const after = await session.stub.loadedModules();
      expect(after.filter((path) => path.endsWith('/step.ts'))).toHaveLength(1);
      await run();
      expect(await session.stub.loadedModules()).toEqual(after);
      session.closeScope(scopeId);
      const first = await service.lease<DemoApi>('demo', { settingsKey: 'a' });
      const firstPid = await first.stub.pid();
      const privateScope = first.openScope({ marker: 'first dispatch only' });
      const granted = jest.fn();
      const pending = service.lease<DemoApi>('demo', { settingsKey: 'a' }).then((lease) => {
        granted();
        return lease;
      });
      await Promise.resolve();
      expect(granted).not.toHaveBeenCalled();
      await first.release();
      expect(() => first.openScope({})).toThrow('released');
      expect(() => first.stub.pid()).toThrow('released');
      const second = await pending;
      expect(await second.stub.pid()).toBe(firstPid);
      expect(() => second.getScope(privateScope)).toThrow('does not belong');
      expect(() => session.getScope(privateScope)).toThrow('does not belong');
      await second.release();
      const renewed = await service.lease<DemoApi>('demo', { settingsKey: 'a' });
      expect((await renewed.stub.pid()) === firstPid).toBe(backend === 'in_process');
      expect((await renewed.stub.loadedModules()).some((path) => path.endsWith('/step.ts'))).toBe(
        false
      );
      expect(() => session.openScope({})).toThrow('closed');
      await renewed.release();
    } finally {
      await service.stop();
      if (previousHeaders === undefined) delete process.env.KBN_RUNNER_INTERNAL_HEADERS;
      else process.env.KBN_RUNNER_INTERNAL_HEADERS = previousHeaders;
      rmSync(directory, { recursive: true });
    }
  },
  15000
);

it('refuses a stale child-process step-registration digest and cleans up the failed host', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-stale-'));
  const service = new RemoteService(loggingSystemMock.createLogger(), {
    maxOldGenerationSizeMb: 256,
    bundleDirectory: directory,
  });
  try {
    await buildRemoteBundle({
      manifests: [join(plugin, 'server/remote/index.ts')],
      graph: { id: 'demo', root: 'demo.root', dependencies: ['demo.catalog'], contributions: [] },
      outdir: join(directory, 'demo'),
    });
    service.discover([plugin]);
    service.register({
      id: 'demo',
      root: createToken('demo.root'),
      dependencies: [createToken('demo.catalog')],
      contributions: [createToken('demo.step')],
    });
    service.bind(createToken('demo.echo'), () => new CoordinatorEcho());
    await expect(service.start('child_process')).rejects.toThrow('registration mismatch');
  } finally {
    await service.stop();
    rmSync(directory, { recursive: true });
  }
});

it.each(['error', 'peerClose'] as const)(
  'disposes active child work on transport %s and replaces the host',
  async (event) => {
    const directory = mkdtempSync(join(tmpdir(), 'runner-transport-end-'));
    const effects = join(directory, 'effects');
    const children: childProcess.ChildProcess[] = [];
    const originalFork = childProcess.fork;
    const spy = jest
      .spyOn(jest.requireActual<typeof childProcess>('node:child_process'), 'fork')
      .mockImplementation((...args: Parameters<typeof childProcess.fork>) => {
        const child = originalFork(...args);
        children.push(child);
        return child;
      });
    const service = new RemoteService(loggingSystemMock.createLogger(), {
      maxOldGenerationSizeMb: 256,
      bundleDirectory: directory,
    });
    try {
      await buildRemoteBundle({
        manifests: [join(plugin, 'server/remote/index.ts')],
        graph: {
          id: 'demo',
          root: 'demo.root',
          dependencies: ['demo.catalog'],
          contributions: ['demo.step'],
        },
        outdir: join(directory, 'demo'),
      });
      service.discover([plugin]);
      service.register({
        id: 'demo',
        root: createToken('demo.root'),
        dependencies: [createToken('demo.catalog')],
        contributions: [createToken('demo.step')],
      });
      service.bind(createToken('demo.echo'), () => new CoordinatorEcho());
      await service.start('child_process');
      const lease = await service.lease<DemoApi & { untilDisposed(path: string): Promise<void> }>(
        'demo'
      );
      const pid = await lease.stub.pid();
      void lease.stub.untilDisposed(effects).catch(() => {});
      for (let attempt = 0; attempt < 100 && !existsSync(effects); attempt++) await delay(10);
      expect(readFileSync(effects, 'utf8')).toContain('started');
      const exited = new Promise<void>((resolveExit) =>
        children[0].once('exit', () => resolveExit())
      );
      if (event === 'error') children[0].emit('error', new Error('transport failed'));
      else children[0].emit('message', { kind: 'remote-seam', payload: null });
      // Failure must dispose without another acquisition or service.stop driving retirement.
      await delay(150);
      expect(readFileSync(effects, 'utf8')).toContain('aborted');
      await exited;
      const writes = readFileSync(effects, 'utf8');
      await delay(30);
      expect(readFileSync(effects, 'utf8')).toBe(writes);
      expect(writes.slice(writes.indexOf('aborted'))).not.toContain('sideEffect');
      await lease.release();
      const next = await service.lease<DemoApi>('demo');
      expect(await next.stub.pid()).not.toBe(pid);
      expect(await next.stub.bindingLabel()).toBe('executor');
      await next.release();
    } finally {
      await service.stop();
      spy.mockRestore();
      rmSync(directory, { recursive: true });
    }
  },
  15000
);

it.each(['in_process', 'child_process'] as const)(
  '%s: the RSS ceiling retires only a separate process, after a completed lease',
  async (backend) => {
    const directory = mkdtempSync(join(tmpdir(), 'runner-rss-'));
    const service = new RemoteService(loggingSystemMock.createLogger(), {
      maxOldGenerationSizeMb: 256,
      bundleDirectory: directory,
    });
    try {
      await buildRemoteBundle({
        manifests: [join(plugin, 'server/remote/index.ts')],
        graph: {
          id: 'demo',
          root: 'demo.root',
          dependencies: ['demo.catalog'],
          contributions: ['demo.step'],
        },
        outdir: join(directory, 'demo'),
      });
      service.discover([plugin]);
      service.register({
        id: 'demo',
        reuse: { maxAgeMs: 60_000, maxRuns: 100, maxRssBytes: 1 },
        root: createToken('demo.root'),
        dependencies: [createToken('demo.catalog')],
        contributions: [createToken('demo.step')],
      });
      service.bind(createToken('demo.echo'), () => new CoordinatorEcho());
      await service.start(backend);
      const first = await service.lease<DemoApi>('demo');
      const firstPid = await first.stub.pid();
      const firstScope = first.openScope({});
      expect((await first.stub.run({ scopeId: firstScope, steps: [] })).outputs).toEqual([]);
      // An intentionally tiny test ceiling must not interrupt the active run.
      expect(await first.stub.pid()).toBe(firstPid);
      await first.release();
      if (backend === 'child_process') {
        expect(() => process.kill(firstPid, 0)).toThrow();
      }
      const second = await service.lease<DemoApi>('demo');
      const secondPid = await second.stub.pid();
      expect(secondPid === firstPid).toBe(backend === 'in_process');
      const scopeId = second.openScope({});
      expect((await second.stub.run({ scopeId, steps: [] })).outputs).toEqual([]);
      await second.release();
    } finally {
      await service.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  },
  30_000
);

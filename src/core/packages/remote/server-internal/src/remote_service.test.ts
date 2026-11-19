/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import * as workerThreads from 'node:worker_threads';
import { getEventListeners } from 'node:events';
import * as childProcess from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScopeLookup } from '@kbn/core-remote-server';
import type { Logger } from '@kbn/logging';
import { RemoteService } from './remote_service';
import { Echo } from './__fixtures__/demo_plugin/server/remote/echo';
import { Root } from './__fixtures__/demo_plugin/server/remote/root';
import {
  DemoCatalogToken,
  DemoRootToken,
  DemoStepKind,
  EchoToken,
  DemoValueToken,
} from './__fixtures__/demo_plugin/server/remote/tokens';

const FIXTURE = join(__dirname, '__fixtures__', 'demo_plugin');
const OTHER_FIXTURE = join(__dirname, '__fixtures__', 'other_plugin');
const ECHO_MODULE = join(FIXTURE, 'server', 'remote', 'echo.ts');

const logger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  trace: jest.fn(),
  fatal: jest.fn(),
  log: jest.fn(),
  isLevelEnabled: () => false,
  get: () => logger,
} as unknown as Logger;

function createService(maxRuns = 100): RemoteService {
  const service = new RemoteService(logger, { maxOldGenerationSizeMb: 256 });
  service.discover([FIXTURE]);
  service.register({
    id: 'demo',
    reuse: { maxRuns, maxAgeMs: 60_000 },
    root: DemoRootToken,
    contributions: [DemoStepKind],
    dependencies: [DemoCatalogToken],
  });
  service.bind(EchoToken, () => new Echo());
  return service;
}

describe('RemoteService', () => {
  jest.setTimeout(30_000);

  it('runs the same graph in-process when Core selects that backend', async () => {
    const service = createService();
    await service.start('in_process');
    const session = await service.whenReady<{
      run(request: { scopeId: string; steps?: Array<{ type: string }> }): Promise<{
        executor: { isMainThread: boolean };
        coordinator: { isMainThread: boolean; marker: string };
        outputs: Array<{ marker: string }>;
      }>;
    }>('demo');
    const scopeId = session.openScope({ request: { id: 'local' } });
    const result = await session.stub.run({
      scopeId,
      steps: [{ type: 'demo.echoStep' }],
    });
    expect(result.executor.isMainThread).toBe(true);
    expect(result.coordinator.isMainThread).toBe(true);
    expect(result.coordinator.marker).toBe('coordinator');
    expect(result.outputs[0].marker).toBe('coordinator');
    await service.stop();
  });

  it('runs the executor on a worker and coordinator capabilities on main', async () => {
    const service = createService();
    await service.start('worker_thread');
    const session = await service.whenReady<{
      run(request: { scopeId: string; steps?: Array<{ type: string }> }): Promise<{
        executor: { isMainThread: boolean; threadId: number };
        coordinator: { isMainThread: boolean; marker: string; threadId: number };
        outputs: Array<{ marker: string }>;
      }>;
      block(milliseconds: number): Promise<number>;
      loadedModules(): Promise<string[]>;
    }>('demo');

    const scopeId = session.openScope({ request: { id: 'remote' } });
    const result = await session.stub.run({
      scopeId,
      steps: [{ type: 'demo.echoStep' }],
    });
    expect(result.executor.isMainThread).toBe(false);
    expect(result.coordinator.isMainThread).toBe(true);
    expect(result.coordinator.marker).toBe('coordinator');
    expect(result.executor.threadId).not.toBe(result.coordinator.threadId);
    expect(result.outputs[0].marker).toBe('coordinator');

    const loaded = await session.stub.loadedModules();
    expect(loaded.some((modulePath) => modulePath === ECHO_MODULE)).toBe(false);

    await expect(session.stub.run({ scopeId, steps: [{ type: 'demo.missing' }] })).rejects.toThrow(
      /Unsupported remote step type/
    );

    const pending = session.stub.block(300);
    let ticks = 0;
    const started = Date.now();
    while (Date.now() - started < 150) {
      await new Promise((resolve) => setImmediate(resolve));
      ticks++;
    }
    expect(ticks).toBeGreaterThan(2);
    await pending;
    session.closeScope(scopeId);
    await service.stop();
  });

  it('ignores another graph root, catalogue, and coordinator capability', async () => {
    const service = new RemoteService(logger, { maxOldGenerationSizeMb: 256 });
    service.discover([OTHER_FIXTURE, FIXTURE]);
    service.register({
      id: 'demo',
      root: DemoRootToken,
      contributions: [DemoStepKind],
      dependencies: [DemoCatalogToken],
    });
    service.bind(EchoToken, () => new Echo());
    await service.start('in_process');
    const session = await service.whenReady<{
      run(request: { scopeId: string; steps?: Array<{ type: string }> }): Promise<{
        outputs: Array<{ marker: string }>;
      }>;
    }>('demo');
    const scopeId = session.openScope({ request: { id: 'isolated' } });
    const result = await session.stub.run({ scopeId, steps: [{ type: 'demo.echoStep' }] });
    expect(result.outputs[0].marker).toBe('coordinator');
    session.closeScope(scopeId);
    await service.stop();
  });
});

it('reuses coordinator bindings across retired and replacement hosts', async () => {
  const service = createService(1);
  const factory = jest.fn(() => new Echo());
  service.bind(EchoToken, factory);
  try {
    await service.start('in_process');
    for (let index = 0; index < 12; index++) {
      const lease = await service.lease('demo');
      await lease.release();
    }
    expect(factory).toHaveBeenCalledTimes(1);
  } finally {
    await service.stop();
  }
});

it('rejects an unspawned child promptly without waiting for exit and can stop', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'remote-spawn-failure-'));
  mkdirSync(join(directory, 'demo'));
  writeFileSync(join(directory, 'demo', 'graph.mjs'), '');
  const child = Object.assign(new childProcess.ChildProcess(), {
    pid: undefined,
    exitCode: null,
    signalCode: null,
    send: jest.fn(() => {
      queueMicrotask(() => child.emit('error', new Error('spawn EAGAIN')));
      return false;
    }),
    kill: jest.fn(),
  });
  const fork = jest
    .spyOn(jest.requireActual<typeof childProcess>('node:child_process'), 'fork')
    .mockReturnValue(child);
  const service = new RemoteService(logger, {
    maxOldGenerationSizeMb: 256,
    bundleDirectory: directory,
  });
  service.discover([FIXTURE]);
  service.register({
    id: 'demo',
    root: DemoRootToken,
    contributions: [DemoStepKind],
    dependencies: [DemoCatalogToken],
  });
  service.bind(EchoToken, () => new Echo());
  try {
    await expect(service.start('child_process')).rejects.toThrow('spawn EAGAIN');
    await service.stop();
    expect(child.kill).not.toHaveBeenCalled();
  } finally {
    fork.mockRestore();
    rmSync(directory, { recursive: true });
  }
}, 2000);

it('disposes an active in-process executor before stop resolves', async () => {
  const started = Promise.withResolvers<void>();
  const aborted = jest.fn();
  const sideEffect = jest.fn();
  const service = createService();
  service.bindInProcess(DemoValueToken, () => ({
    label: (event: string) => {
      if (event === 'started') started.resolve();
      if (event === 'aborted') aborted();
      if (event === 'sideEffect') sideEffect();
      return 'test';
    },
  }));
  try {
    await service.start('in_process');
    const session = await service.whenReady<{ untilDisposed(): Promise<void> }>('demo');
    const pending = session.stub.untilDisposed().catch(() => {});
    await started.promise;
    await service.stop();
    expect(aborted).toHaveBeenCalledTimes(1);
    const count = sideEffect.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(sideEffect).toHaveBeenCalledTimes(count);
    void pending;
  } finally {
    await service.stop();
  }
});

it('closes both ports when an in-process binding factory throws', async () => {
  const channels: workerThreads.MessageChannel[] = [];
  const OriginalChannel = workerThreads.MessageChannel;
  const spy = jest
    .spyOn(jest.requireActual<typeof workerThreads>('node:worker_threads'), 'MessageChannel')
    .mockImplementation(() => {
      const channel = new OriginalChannel();
      channels.push(channel);
      return channel;
    });
  const service = createService();
  service.bindInProcess(DemoValueToken, () => {
    throw new Error('binding failed');
  });
  const readiness = service.whenReady('demo').catch(() => {});
  try {
    const startup = service.start('in_process');
    const closed = channels
      .flatMap(({ port1, port2 }) => [port1, port2])
      .map((port) => new Promise<void>((resolve) => port.once('close', resolve)));
    await expect(startup).rejects.toThrow('binding failed');
    expect(channels).toHaveLength(1);
    await Promise.all(closed);
    await readiness;
  } finally {
    for (const { port1, port2 } of channels) {
      port1.close();
      port2.close();
    }
    await service.stop();
    spy.mockRestore();
  }
});

it.each(['closeScope', 'stop', 'close', 'messageerror'] as const)(
  'ends scope lifetimes on %s and releases their controllers',
  async (event) => {
    const channels: workerThreads.MessageChannel[] = [];
    const OriginalChannel = workerThreads.MessageChannel;
    const spy = jest
      .spyOn(jest.requireActual<typeof workerThreads>('node:worker_threads'), 'MessageChannel')
      .mockImplementation(() => {
        const channel = new OriginalChannel();
        channels.push(channel);
        return channel;
      });
    const service = createService();
    const signals: AbortSignal[] = [];
    service.bind(EchoToken, (scopes) => {
      const echo = new Echo();
      service.bindInProcess(DemoValueToken, () => ({
        label: () => {
          signals.push(scopes.getAbortSignal(currentScope));
          return 'test';
        },
      }));
      return echo;
    });
    let currentScope = '';
    try {
      await service.start('in_process');
      const session = await service.whenReady<{ bindingLabel(): Promise<string> }>('demo');
      for (let index = 0; index < 12; index++) {
        currentScope = session.openScope({});
        await session.stub.bindingLabel();
        const signal = signals[index];
        expect(signal.aborted).toBe(false);
        expect(getEventListeners(signal, 'abort')).toHaveLength(0);
        if (event === 'closeScope') session.closeScope(currentScope);
        else if (event === 'stop') await service.stop();
        else channels[0].port1.emit(event, new Event(event));
        expect(signal.aborted).toBe(true);
        expect(() => session.getScope(currentScope)).toThrow();
        if (event !== 'closeScope') break;
      }
      expect(Reflect.get(service, 'scopeControllers').size).toBe(0);
    } finally {
      await service.stop();
      spy.mockRestore();
    }
  }
);

it.each(['disconnect', 'messageerror'] as const)(
  'aborts coordinator work on worker %s before its external effect completes',
  async (event) => {
    const channels: workerThreads.MessageChannel[] = [];
    const OriginalChannel = workerThreads.MessageChannel;
    const spy = jest
      .spyOn(jest.requireActual<typeof workerThreads>('node:worker_threads'), 'MessageChannel')
      .mockImplementation(() => {
        const channel = new OriginalChannel();
        channels.push(channel);
        return channel;
      });
    const service = createService();
    const started = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const aborted = jest.fn();
    const sideEffect = jest.fn();
    service.bind(EchoToken, (scopes) => {
      class ScopedEcho {
        async where(scopeId: string) {
          const signal = scopes.getAbortSignal(scopeId);
          started.resolve();
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              sideEffect();
              resolve();
            }, 100);
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                aborted();
                resolve();
              },
              { once: true }
            );
          });
          finished.resolve();
          return { threadId: 0, isMainThread: true, marker: 'coordinator' };
        }
      }
      return new ScopedEcho();
    });
    try {
      await service.start('worker_thread');
      const lease = await service.lease<{ run(request: { scopeId: string }): Promise<object> }>(
        'demo'
      );
      const scopeId = lease.openScope({});
      void lease.stub.run({ scopeId }).catch(() => {});
      await started.promise;
      if (event === 'disconnect') channels[0].port1.close();
      else channels[0].port1.emit('messageerror', new Error('decode failed'));
      await finished.promise;
      await lease.release();
      expect(aborted).toHaveBeenCalledTimes(1);
      await new Promise((resolve) => setTimeout(resolve, 125));
      expect(sideEffect).not.toHaveBeenCalled();
      expect(Reflect.get(service, 'scopeControllers').size).toBe(0);
    } finally {
      await service.stop();
      spy.mockRestore();
    }
  }
);

it.each(['close', 'messageerror', 'peerClose'] as const)(
  'disposes active in-process work on transport %s and replaces the host',
  async (event) => {
    const channels: workerThreads.MessageChannel[] = [];
    const OriginalChannel = workerThreads.MessageChannel;
    const spy = jest
      .spyOn(jest.requireActual<typeof workerThreads>('node:worker_threads'), 'MessageChannel')
      .mockImplementation(() => {
        const channel = new OriginalChannel();
        channels.push(channel);
        return channel;
      });
    const started = Promise.withResolvers<void>();
    const aborted = jest.fn();
    const sideEffect = jest.fn();
    const service = createService();
    service.bindInProcess(DemoValueToken, () => ({
      label: (labelEvent: string) => {
        if (labelEvent === 'started') started.resolve();
        if (labelEvent === 'aborted') aborted();
        if (labelEvent === 'sideEffect') sideEffect();
        return 'healthy';
      },
    }));
    try {
      await service.start('in_process');
      const lease = await service.lease<{ untilDisposed(): Promise<void> }>('demo');
      void lease.stub.untilDisposed().catch(() => {});
      await started.promise;
      if (event === 'close') channels[0].port1.close();
      else if (event === 'peerClose') channels[0].port1.emit('message', null);
      else channels[0].port1.emit('messageerror', new Error('decode failed'));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(aborted).toHaveBeenCalledTimes(1);
      const count = sideEffect.mock.calls.length;
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(sideEffect).toHaveBeenCalledTimes(count);
      await lease.release();
      const next = await service.lease<{ bindingLabel(): Promise<string> }>('demo');
      expect(channels).toHaveLength(2);
      expect(await next.stub.bindingLabel()).toBe('healthy');
      await next.release();
    } finally {
      await service.stop();
      spy.mockRestore();
    }
  }
);

it('rejects and logs shutdown when an in-process executor disposal hangs', async () => {
  const gate = Promise.withResolvers<void>();
  const dispose = jest
    .spyOn(Root.prototype, Symbol.asyncDispose)
    .mockImplementation(() => gate.promise);
  const service = createService();
  try {
    await service.start('in_process');
    jest.useFakeTimers();
    const stopping = service.stop();
    const rejected = expect(stopping).rejects.toThrow(
      'Remote host "demo" did not close within 5000ms'
    );
    await jest.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Remote host "demo" did not close within 5000ms' })
    );
  } finally {
    gate.resolve();
    jest.useRealTimers();
    dispose.mockRestore();
  }
});

it('kills and awaits a child that ignores coordinator disconnect', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'remote-ignore-disconnect-'));
  mkdirSync(join(directory, 'demo'));
  writeFileSync(
    join(directory, 'demo', 'graph.mjs'),
    `
    process.on('message', () => process.send({ kind: 'ready' }));
    process.on('disconnect', () => {});
    setInterval(() => {}, 100);
  `
  );
  const children: childProcess.ChildProcess[] = [];
  const originalFork = childProcess.fork;
  const spy = jest
    .spyOn(jest.requireActual<typeof childProcess>('node:child_process'), 'fork')
    .mockImplementation((...args: Parameters<typeof childProcess.fork>) => {
      const child = originalFork(...args);
      children.push(child);
      return child;
    });
  const service = new RemoteService(logger, {
    maxOldGenerationSizeMb: 256,
    bundleDirectory: directory,
  });
  service.discover([FIXTURE]);
  service.register({
    id: 'demo',
    root: DemoRootToken,
    contributions: [DemoStepKind],
    dependencies: [DemoCatalogToken],
  });
  service.bind(EchoToken, () => new Echo());
  try {
    await service.start('child_process');
    const started = Date.now();
    await service.stop();
    expect(children[0].signalCode).toBe('SIGKILL');
    expect(Date.now() - started).toBeLessThan(3000);
    expect(children[0].listenerCount('exit')).toBe(0);
    await service.stop();
  } finally {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    spy.mockRestore();
    rmSync(directory, { recursive: true });
  }
}, 5000);

it('bounds boot-timeout cleanup of a spawned child ignoring SIGTERM', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'remote-boot-timeout-'));
  mkdirSync(join(directory, 'demo'));
  writeFileSync(
    join(directory, 'demo', 'graph.mjs'),
    `
    process.on('SIGTERM', () => {});
    process.on('disconnect', () => {});
    process.on('message', () => process.send({ kind: 'test-booting' }));
    setInterval(() => {}, 100);
  `
  );
  const children: childProcess.ChildProcess[] = [];
  const booting = Promise.withResolvers<void>();
  const originalFork = childProcess.fork;
  const spy = jest
    .spyOn(jest.requireActual<typeof childProcess>('node:child_process'), 'fork')
    .mockImplementation((...args: Parameters<typeof childProcess.fork>) => {
      const child = originalFork(...args);
      children.push(child);
      child.on('message', () => booting.resolve());
      return child;
    });
  const service = new RemoteService(logger, {
    maxOldGenerationSizeMb: 256,
    bundleDirectory: directory,
  });
  service.discover([FIXTURE]);
  service.register({
    id: 'demo',
    root: DemoRootToken,
    contributions: [DemoStepKind],
    dependencies: [DemoCatalogToken],
  });
  service.bind(EchoToken, () => new Echo());
  try {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const startup = service.start('child_process');
    const rejected = expect(startup).rejects.toThrow('boot timed out');
    await booting.promise;
    const started = Date.now();
    await jest.advanceTimersByTimeAsync(120_000);
    await jest.advanceTimersByTimeAsync(1000);
    expect(Date.now() - started).toBe(121_000);
    jest.useRealTimers();
    const cleanupStarted = Date.now();
    let watchdog: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        rejected,
        new Promise<never>((_resolve, reject) => {
          watchdog = setTimeout(() => reject(new Error('Boot cleanup exceeded 2s watchdog')), 2000);
        }),
      ]);
    } finally {
      clearTimeout(watchdog);
    }
    expect(Date.now() - cleanupStarted).toBeLessThan(2000);
    expect(children[0].signalCode).toBe('SIGKILL');
    await service.stop();
    expect(children[0].listenerCount('exit')).toBe(0);
  } finally {
    jest.useRealTimers();
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    spy.mockRestore();
    rmSync(directory, { recursive: true });
  }
}, 5000);

it('rejects an invalid measurement delay before spawning a child', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'remote-invalid-delay-'));
  mkdirSync(join(directory, 'demo'));
  writeFileSync(join(directory, 'demo', 'graph.mjs'), '');
  const previous = process.env.KBN_REMOTE_MESSAGE_DELAY_MS;
  const spawn = jest.spyOn(childProcess, 'fork');
  const service = new RemoteService(logger, {
    maxOldGenerationSizeMb: 256,
    bundleDirectory: directory,
  });
  try {
    process.env.KBN_REMOTE_MESSAGE_DELAY_MS = 'invalid';
    service.discover([FIXTURE]);
    service.register({
      id: 'demo',
      root: DemoRootToken,
      contributions: [DemoStepKind],
      dependencies: [DemoCatalogToken],
    });
    service.bind(EchoToken, () => new Echo());
    await expect(service.start('child_process')).rejects.toThrow('KBN_REMOTE_MESSAGE_DELAY_MS');
    expect(spawn).not.toHaveBeenCalled();
    await service.stop();
  } finally {
    if (previous === undefined) delete process.env.KBN_REMOTE_MESSAGE_DELAY_MS;
    else process.env.KBN_REMOTE_MESSAGE_DELAY_MS = previous;
    spawn.mockRestore();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('owns run sidecars and admissions only on coordinator, and clears them when a scope closes', async () => {
  const service = createService();
  let scopes: ScopeLookup | undefined;
  service.bind(EchoToken, (lookup) => {
    scopes = lookup;
    return new Echo();
  });
  await service.start('in_process');
  const lease = await service.lease('demo');
  try {
    if (!scopes) throw new Error('Coordinator binding missing');
    expect(() => scopes?.getRunState('unknown')).toThrow('scope');
    const admittedChildren = new Set(['restored']);
    const state = {
      workflowRunId: 'run',
      workflowId: 'workflow',
      workflowName: 'Persisted',
      spaceId: 'space',
      admittedChildren,
    };
    const scopeId = lease.openScope({ request: true }, state);
    admittedChildren.add('not-admitted');
    expect(scopes.getRunState(scopeId).admittedChildren).toEqual(new Set(['restored']));
    scopes.admitChild(scopeId, 'started');
    expect(scopes.getRunState(scopeId).admittedChildren).toEqual(new Set(['restored', 'started']));
    expect(Object.keys(lease)).not.toContain('admitChild');
    lease.closeScope(scopeId);
    expect(() => scopes?.getRunState(scopeId)).toThrow('scope');
  } finally {
    await lease.release();
    await service.stop();
  }
});

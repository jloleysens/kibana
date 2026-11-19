/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { randomUUID } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import {
  openPortSession,
  remoteTokenId,
  selectRemoteDeclarations,
  type RemoteModule,
  type RemoteWorkerSpec,
} from '@kbn/core-remote-common';
import type { Logger } from '@kbn/logging';
import type { ServiceToken } from '@kbn/core-di';
import type {
  RemoteBackend,
  RemoteLease,
  RemoteRegistration,
  RemoteSession,
  RemoteSetup,
  ScopeLookup,
  RemoteRunState,
} from '@kbn/core-remote-server';
import { createManagedWorker } from '@kbn/core-threads-server-internal';
import { RemoteLeasePool, type LeaseHost } from './remote_lease_pool';
import { buildExecutor } from './build_executor';
import { CoordinatorGateway } from './coordinator_gateway';
import { createBridge } from './executor_bridge';
import { openIpcSession, type IpcSession } from './ipc_session';
import { graphSignature } from './graph_signature';
import { getIpcMessageDelayMs } from './ipc_transport';

const loadModule = createRequire(__filename);
const ENTRY = loadModule.resolve('./remote_worker_entry');

/**
 * Core-owned remote execution host. Plugins register graphs and bind coordinator
 * capabilities; this service selects the backend and owns the worker connection.
 */
export class RemoteService implements RemoteSetup {
  private readonly modules: RemoteModule[] = [];
  private readonly registrations = new Map<string, RemoteRegistration>();
  private readonly bindings = new Map<string, (scopes: ScopeLookup) => object>();
  private readonly inProcessBindings = new Map<string, (scopes: ScopeLookup) => object>();
  private readonly scopes = new Map<string, unknown>();
  private readonly runStates = new Map<
    string,
    RemoteRunState & { admittedChildren: Set<string> }
  >();
  private readonly stepOutputLimits = new Map<string, ReadonlyMap<string, number>>();
  private readonly scopeControllers = new Map<string, AbortController>();
  private readonly sessions = new Map<string, Promise<RemoteSession<unknown>>>();
  private readonly resolvers = new Map<string, (session: RemoteSession<unknown>) => void>();
  private readonly pools = new Map<string, RemoteLeasePool<RemoteSession<unknown>>>();
  private readonly rejectors = new Map<string, (error: Error) => void>();
  private started = false;
  private readonly lookup: ScopeLookup = {
    resolveStepOutputLimit: (scopeId, stepId) => {
      const limit = this.stepOutputLimits.get(scopeId)?.get(stepId);
      if (limit === undefined) throw new Error('Unknown remote step output policy');
      return limit;
    },
    getRunState: (scopeId) => {
      const state = this.runStates.get(scopeId);
      if (!state) throw new Error('Unknown remote run scope');
      return { ...state, admittedChildren: new Set(state.admittedChildren) };
    },
    admitChild: (scopeId, childId) => {
      const state = this.runStates.get(scopeId);
      if (!state) throw new Error('Unknown remote run scope');
      state.admittedChildren.add(childId);
    },
    getAbortSignal: (scopeId) => {
      const controller = this.scopeControllers.get(scopeId);
      if (!controller) throw new Error(`Unknown remote invocation scope "${scopeId}"`);
      return controller.signal;
    },
    get: <T>(scopeId: string): T => {
      if (!this.scopes.has(scopeId)) {
        throw new Error(`Unknown remote invocation scope "${scopeId}"`);
      }
      return this.scopes.get(scopeId) as T;
    },
  };

  constructor(
    private readonly logger: Logger,
    private readonly limits: { maxOldGenerationSizeMb: number; bundleDirectory?: string } = {
      maxOldGenerationSizeMb: 1024,
    }
  ) {}

  public discover(pluginPaths: readonly string[]): void {
    for (const pluginPath of pluginPaths) {
      const tsEntry = join(pluginPath, 'server', 'remote', 'index.ts');
      const jsEntry = join(pluginPath, 'server', 'remote', 'index.js');
      const entry = existsSync(tsEntry) ? tsEntry : existsSync(jsEntry) ? jsEntry : undefined;
      if (!entry) continue;
      // Discovery loads the declaration entry only. Implementation modules stay behind their declared paths.
      const loaded = loadModule(entry) as { remoteModule?: RemoteModule };
      if (!loaded.remoteModule) {
        throw new Error(`${entry} must export remoteModule`);
      }
      this.modules.push(loaded.remoteModule);
      this.logger.info(`Discovered remote module ${entry}`);
    }
  }

  public register(registration: RemoteRegistration): void {
    if (this.registrations.has(registration.id)) {
      throw new Error(`Remote graph "${registration.id}" is already registered`);
    }
    this.registrations.set(registration.id, registration);
    this.prepareReadiness(registration.id);
  }

  private prepareReadiness(id: string): void {
    const pending = new Promise<RemoteSession<unknown>>((resolve, reject) => {
      this.resolvers.set(id, resolve);
      this.rejectors.set(id, reject);
    });
    // Startup reports the same failure; callers may not have attached a readiness waiter yet.
    void pending.catch(() => undefined);
    this.sessions.set(id, pending);
  }

  public bind(token: ServiceToken<unknown>, factory: (scopes: ScopeLookup) => object): void {
    this.bindings.set(remoteTokenId(token), factory);
  }

  public bindInProcess(
    token: ServiceToken<unknown>,
    factory: (scopes: ScopeLookup) => object
  ): void {
    this.inProcessBindings.set(remoteTokenId(token), factory);
  }

  public whenReady<T>(id: string): Promise<RemoteSession<T>> {
    const pending = this.sessions.get(id);
    if (!pending) {
      return Promise.reject(new Error(`Remote graph "${id}" is not registered`));
    }
    return pending as Promise<RemoteSession<T>>;
  }

  public async lease<T>(
    id: string,
    options: { settingsKey?: string; signal?: AbortSignal } = {}
  ): Promise<RemoteLease<T>> {
    let pool = this.pools.get(id);
    if (!pool) {
      await this.whenReady(id);
      pool = this.pools.get(id);
    }
    if (!pool) throw new Error('Remote graph lease pool is unavailable');
    const acquired = await pool.acquire(options.settingsKey ?? '', options.signal);
    const session = acquired.value as RemoteSession<T>;
    const scopeIds = new Set<string>();
    let released = false;
    const assertActive = () => {
      if (released) throw new Error('Remote lease is released');
    };
    const stub = new Proxy(session.stub as object, {
      get(target, property) {
        assertActive();
        if (property === 'then' || property === 'catch' || property === 'finally') return;
        const member = Reflect.get(target, property);
        return typeof member === 'function'
          ? (...args: unknown[]) => {
              assertActive();
              return Reflect.apply(member, target, args);
            }
          : member;
      },
    }) as T;
    return {
      stub,
      openScope: (state, runState, stepOutputLimits) => {
        assertActive();
        const scopeId = session.openScope(state, runState, stepOutputLimits);
        scopeIds.add(scopeId);
        return scopeId;
      },
      closeScope: (scopeId) => {
        if (scopeIds.delete(scopeId)) session.closeScope(scopeId);
      },
      getScope: <TState>(scopeId: string) => {
        assertActive();
        if (!scopeIds.has(scopeId)) throw new Error('Scope does not belong to this lease');
        return session.getScope<TState>(scopeId);
      },
      release: async (discard) => {
        if (released) return;
        released = true;
        for (const scopeId of scopeIds) session.closeScope(scopeId);
        scopeIds.clear();
        await acquired.release(discard);
      },
    };
  }

  public async start(backend: RemoteBackend): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (this.registrations.size === 0) {
      this.logger.info('No remote graphs registered; skipping remote startup');
      return;
    }
    this.logger.info('Starting remote execution with backend ' + backend);
    for (const registration of this.registrations.values()) {
      const spec = this.buildSpec(registration);
      const coordinator = this.materializeCoordinator(spec);
      let initialized = false;
      const pool = new RemoteLeasePool(
        async () => {
          if (initialized) this.prepareReadiness(registration.id);
          initialized = true;
          try {
            if (backend === 'in_process')
              return await this.startInProcess(registration.id, spec, coordinator);
            if (backend === 'child_process')
              return await this.startProcess(registration.id, spec, coordinator);
            return await this.startWorker(registration.id, spec, coordinator);
          } catch (error) {
            this.rejectors.get(registration.id)?.(
              error instanceof Error ? error : new Error(String(error))
            );
            throw error;
          }
        },
        registration.reuse ?? { maxAgeMs: 5 * 60_000, maxRuns: 100 },
        Date.now,
        registration.id
      );
      this.pools.set(registration.id, pool);
      await pool.warm();
    }
  }

  public async stop(): Promise<void> {
    await Promise.all(
      [...this.pools.values()].map((pool) =>
        pool.stop().catch((error: Error) => {
          this.logger.error(error);
          throw error;
        })
      )
    );
    this.scopes.clear();
  }

  private buildSpec(registration: RemoteRegistration): RemoteWorkerSpec {
    const kindIds = new Set(registration.contributions.map((kind) => remoteTokenId(kind)));
    const rootId = remoteTokenId(registration.root);
    const dependencyIds = new Set(
      (registration.dependencies ?? []).map((token) => remoteTokenId(token))
    );
    let root: RemoteWorkerSpec['root'] | undefined;
    let catalog: RemoteWorkerSpec['catalog'];
    const executorProviders: RemoteWorkerSpec['executorProviders'][number][] = [];
    const contributions: RemoteWorkerSpec['contributions'][number][] = [];
    const coordinatorTokenIds: string[] = [];

    const selected = selectRemoteDeclarations(
      this.modules.map((module) => ({
        providers: (module.providers ?? []).map((provider) => ({
          ...provider,
          token: remoteTokenId(provider.token),
          needs: provider.needs?.map(remoteTokenId),
        })),
        contributions: (module.contributions ?? []).map((contribution) => ({
          ...contribution,
          kind: remoteTokenId(contribution.kind),
          needs: contribution.needs?.map(remoteTokenId),
        })),
      })),
      {
        id: registration.id,
        root: rootId,
        dependencies: [...dependencyIds],
        contributions: [...kindIds],
      }
    );
    for (const provider of selected.providers) {
      const id = provider.token;
      if (provider.role === 'root') {
        if (id !== rootId) continue;
        if (root) {
          throw new Error(`Remote graph "${registration.id}" has more than one root provider`);
        }
        root = { tokenId: id, modulePath: provider.modulePath, exportName: provider.exportName };
        continue;
      }
      if (provider.placement === 'coordinator') {
        if (!coordinatorTokenIds.includes(id)) coordinatorTokenIds.push(id);
        continue;
      }
      if (provider.role === 'catalog') {
        if (catalog) {
          throw new Error(`Remote graph "${registration.id}" has more than one catalogue provider`);
        }
        catalog = {
          tokenId: id,
          modulePath: provider.modulePath,
          exportName: provider.exportName,
        };
        continue;
      }
      executorProviders.push({
        tokenId: id,
        modulePath: provider.modulePath,
        exportName: provider.exportName,
      });
    }
    for (const contribution of selected.contributions) {
      if (!kindIds.has(contribution.kind)) continue;
      contributions.push({
        kindId: contribution.kind,
        stepType: contribution.stepType,
        modulePath: contribution.modulePath,
        exportName: contribution.exportName,
      });
    }
    for (const id of dependencyIds) {
      const provided =
        catalog?.tokenId === id ||
        coordinatorTokenIds.includes(id) ||
        executorProviders.some((provider) => provider.tokenId === id);
      if (!provided) {
        throw new Error(`Remote graph "${registration.id}" is missing dependency "${id}"`);
      }
    }

    if (!root) {
      throw new Error(`Remote graph "${registration.id}" has no executor provider for its root`);
    }
    return {
      id: registration.id,
      root,
      catalog,
      executorProviders,
      contributions,
      coordinatorTokenIds,
    };
  }

  private materializeCoordinator(spec: RemoteWorkerSpec): Map<string, object> {
    const coordinator = new Map<string, object>();
    for (const id of spec.coordinatorTokenIds) {
      const factory = this.bindings.get(id);
      if (!factory) {
        throw new Error(`Coordinator capability "${id}" was declared but not bound`);
      }
      coordinator.set(id, factory(this.lookup));
    }
    return coordinator;
  }

  private openSession<T>(
    id: string,
    stub: T,
    close: () => Promise<void>,
    alive: () => boolean,
    transport?: {
      on(event: string, listener: () => void): void;
      off(event: string, listener: () => void): void;
    },
    transportSignal?: AbortSignal,
    rssBytes?: () => Promise<number>
  ): LeaseHost<RemoteSession<unknown>> {
    const scopeIds = new Set<string>();
    let closed = false;
    const terminated = new AbortController();
    let disposing: Promise<void> | undefined;
    const endScope = (scopeId: string, reason: Error) => {
      if (!scopeIds.delete(scopeId)) return;
      const controller = this.scopeControllers.get(scopeId);
      this.scopeControllers.delete(scopeId);
      this.scopes.delete(scopeId);
      this.runStates.delete(scopeId);
      this.stepOutputLimits.delete(scopeId);
      controller?.abort(reason);
    };
    const endScopes = (reason: Error) => {
      closed = true;
      for (const scopeId of scopeIds) endScope(scopeId, reason);
    };
    const terminate = (reason: Error) => {
      endScopes(reason);
      terminated.abort(reason);
    };
    const onMessage = (message: object | null) => {
      if (message === null) terminate(new Error('Remote RPC peer closed'));
    };
    const messagePort =
      transport && 'postMessage' in transport ? (transport as MessagePort) : undefined;
    messagePort?.on('message', onMessage);
    const events = ['close', 'messageerror', 'error', 'disconnect', 'exit'];
    const listeners = events.map((event) => {
      const listener = () => terminate(new Error(`Remote transport ${event}`));
      transport?.on(event, listener);
      return listener;
    });
    const onTransportAbort = () => terminate(transportSignal?.reason);
    transportSignal?.addEventListener('abort', onTransportAbort, { once: true });
    const session: RemoteSession<T> = {
      stub,
      openScope: (state, runState, stepOutputLimits) => {
        if (closed) throw new Error('Remote host is closed');
        const scopeId = randomUUID();
        this.scopes.set(scopeId, state);
        if (runState)
          this.runStates.set(scopeId, {
            ...runState,
            admittedChildren: new Set(runState.admittedChildren),
          });
        if (stepOutputLimits) this.stepOutputLimits.set(scopeId, new Map(stepOutputLimits));
        this.scopeControllers.set(scopeId, new AbortController());
        scopeIds.add(scopeId);
        return scopeId;
      },
      closeScope: (scopeId) => {
        endScope(scopeId, new Error('Remote scope closed or lease released'));
      },
      getScope: <TState>(scopeId: string) => {
        if (!scopeIds.has(scopeId)) throw new Error('Scope does not belong to this remote host');
        return this.lookup.get<TState>(scopeId);
      },
    };
    const resolve = this.resolvers.get(id);
    if (!resolve) throw new Error('Remote graph has no readiness waiter');
    resolve(session as RemoteSession<unknown>);
    if (transportSignal?.aborted) onTransportAbort();
    return {
      value: session as RemoteSession<unknown>,
      alive: () => !closed && alive(),
      terminated: terminated.signal,
      rssBytes,
      close: () => {
        disposing ??= Promise.resolve().then(async () => {
          endScopes(new Error('Remote host stopped'));
          messagePort?.off('message', onMessage);
          events.forEach((event, index) => transport?.off(event, listeners[index]));
          transportSignal?.removeEventListener('abort', onTransportAbort);
          await close();
        });
        return disposing;
      },
    };
  }

  private async startInProcess(
    id: string,
    spec: RemoteWorkerSpec,
    coordinator: Map<string, object>
  ): Promise<LeaseHost<RemoteSession<unknown>>> {
    const { port1, port2 } = new MessageChannel();
    const bridge = createBridge();
    const stub = openPortSession(port1, new CoordinatorGateway(coordinator));
    const gateway = openPortSession<{ getCapability(tokenId: string): object }>(port2, bridge.rpc);
    const values = new Map(
      spec.coordinatorTokenIds.map((tokenId) => [tokenId, gateway.getCapability(tokenId)])
    );
    const loaded: string[] = [];
    const overrides = new Map<string, object>();
    let executor: object;
    try {
      for (const { tokenId } of spec.executorProviders) {
        const factory = this.inProcessBindings.get(tokenId);
        if (factory) overrides.set(tokenId, factory(this.lookup));
      }
      executor = await buildExecutor(spec, values, loaded, undefined, overrides);
    } catch (error) {
      port1.close();
      port2.close();
      throw error;
    }
    bridge.attach(executor, loaded);
    this.logger.info(`Remote graph "${id}" ready in-process`);
    return this.openSession(
      id,
      stub,
      async () => {
        try {
          if (Symbol.asyncDispose in executor) {
            await (executor as AsyncDisposable)[Symbol.asyncDispose]();
          }
        } finally {
          port1.close();
          port2.close();
        }
      },
      () => true,
      port1
    );
  }

  private async startProcess(
    id: string,
    spec: RemoteWorkerSpec,
    coordinator: Map<string, object>
  ): Promise<LeaseHost<RemoteSession<unknown>>> {
    const directory =
      this.limits.bundleDirectory ?? process.env.KBN_REMOTE_BUNDLE_DIR ?? 'target/remote_bundles';
    const entry = join(directory, id, 'graph.mjs');
    if (!existsSync(entry)) throw new Error(`Remote bundle missing: ${entry}`);
    // Reject invalid measurement settings before allocating a child or an IPC session.
    getIpcMessageDelayMs();
    const child = fork(entry, [], {
      execArgv: [
        `--max-old-space-size=${this.limits.maxOldGenerationSizeMb}`,
        ...(process.env.KBN_REMOTE_LOAD_HOOK ? ['--import', process.env.KBN_REMOTE_LOAD_HOOK] : []),
        ...(process.env.KBN_REMOTE_EXPOSE_GC === 'true' ? ['--expose-gc'] : []),
      ],
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      env: Object.fromEntries(
        [
          'PATH',
          'HOME',
          'LANG',
          'TZ',
          'NODE_ENV',
          'NODE_EXTRA_CA_CERTS',
          'KBN_REMOTE_SEAM_LOG',
          'KBN_REMOTE_HEAP_LOG',
          'KBN_REMOTE_TIMING_LOG',
          'KBN_REMOTE_MODULE_LOG',
          'KBN_REMOTE_WIRE_LOG',
          'KBN_REMOTE_MESSAGE_DELAY_MS',
        ].flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]]))
      ),
    });
    const session = openIpcSession<{ residentSetSize(): number }>(
      child,
      new CoordinatorGateway(coordinator)
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => finish(new Error(`Remote graph "${id}" boot timed out`)),
          120_000
        );
        const onExit = (code: number | null) =>
          finish(new Error(`Remote graph "${id}" exited before ready: ${code}`));
        const onError = (error: Error) => finish(error);
        const onMessage = (message: { kind?: string; message?: string }) => {
          if (message.kind === 'ready') finish();
          if (message.kind === 'boot-error') finish(new Error(message.message));
        };
        const finish = (error?: Error) => {
          clearTimeout(timeout);
          child.off('message', onMessage);
          child.off('exit', onExit);
          child.off('error', onError);
          if (error) reject(error);
          else resolve();
        };
        child.on('message', onMessage);
        child.once('exit', onExit);
        child.once('error', onError);
        child.send({ kind: 'init', signature: graphSignature(spec) });
      });
      this.logger.info(`Remote graph "${id}" ready in process ${child.pid}`);
      return this.openSession(
        id,
        session.remote,
        () => closeChild(child, session),
        () => child.connected && child.exitCode === null && child.signalCode === null,
        child,
        session.signal,
        async () => session.remote.residentSetSize()
      );
    } catch (error) {
      if (child.pid === undefined) session.close();
      else await closeChild(child, session);
      throw error;
    }
  }

  private async startWorker(
    id: string,
    spec: RemoteWorkerSpec,
    coordinator: Map<string, object>
  ): Promise<LeaseHost<RemoteSession<unknown>>> {
    const { port1, port2 } = new MessageChannel();
    const gateway = new CoordinatorGateway(coordinator);
    // Session is established before the worker runs so capability lookups during ready can land.
    const stub = openPortSession(port1, gateway);
    let alive = true;
    const worker = createManagedWorker({
      name: `remote:${id}`,
      entry: ENTRY,
      workerData: spec,
      connectionPort: port2,
      resourceLimits: { maxOldGenerationSizeMb: this.limits.maxOldGenerationSizeMb },
      logger: this.logger,
      unref: true,
      // A transferred port cannot be reused. A replacement worker needs a new port; this handle does not restart.
      restart: { maxAttempts: 0 },
      readyTimeoutMs: 120_000,
      onExit: (info) => {
        alive = false;
        this.logger.warn(
          `Remote graph "${id}" worker exited (${info.reason}); outstanding calls fail and are not replayed`
        );
        port1.close();
      },
    });
    worker.start();
    try {
      await worker.ready();
    } catch (error) {
      port1.close();
      await worker.stop();
      throw error;
    }
    this.logger.info(`Remote graph "${id}" ready on worker thread ${worker.status().threadId}`);
    return this.openSession(
      id,
      stub,
      async () => {
        alive = false;
        port1.close();
        await worker.stop();
      },
      () => alive,
      port1
    );
  }
}

async function closeChild(child: ChildProcess, session: IpcSession<object>): Promise<void> {
  session.close();
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 1000);
  try {
    if (child.connected) child.disconnect();
    await exited;
  } finally {
    clearTimeout(timeout);
  }
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { mkdtempSync, rmSync } from 'node:fs';
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
      await service.start(backend);
      const session = await service.whenReady<DemoApi>('demo');
      const pid = await session.stub.pid();
      expect(pid === process.pid).toBe(backend === 'in_process');
      const original = { marker: 'copy me' };
      expect(await session.stub.copy(original)).toEqual(original);
      expect(await session.stub.copy(original)).not.toBe(original);
      const initial = await session.stub.loadedModules();
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
    } finally {
      await service.stop();
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

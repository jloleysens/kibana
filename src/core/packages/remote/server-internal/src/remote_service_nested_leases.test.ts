/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { join } from 'node:path';
import { withRemoteLeaseParent } from '@kbn/core-remote-server';
import type { Logger } from '@kbn/logging';
import { RemoteService } from './remote_service';
import { Echo } from './__fixtures__/demo_plugin/server/remote/echo';
import {
  DemoCatalogToken,
  DemoRootToken,
  DemoStepKind,
  EchoToken,
  DemoValueToken,
} from './__fixtures__/demo_plugin/server/remote/tokens';

const logger: Logger = {
  get: () => logger,
  log() {},
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  isLevelEnabled: () => false,
};

const createService = () => {
  const service = new RemoteService(logger, { maxOldGenerationSizeMb: 256 });
  service.discover([join(__dirname, '__fixtures__/demo_plugin')]);
  service.register({
    id: 'demo',
    reuse: { maxRuns: 100, maxAgeMs: 60_000 },
    root: DemoRootToken,
    contributions: [DemoStepKind],
    dependencies: [DemoCatalogToken],
  });
  service.bind(EchoToken, () => new Echo());
  return service;
};

it('completes repeated synchronous coordinator-hook nested runs on separate in-process hosts without leaking leases or scopes', async () => {
  const service = createService();
  let hosts = 0;
  service.bindInProcess(DemoValueToken, () => {
    const hostId = ++hosts;
    return { label: () => String(hostId) };
  });
  interface DemoExecutor {
    run(request: { scopeId: string }): Promise<{ coordinator: { marker: string } }>;
    bindingLabel(): Promise<string>;
  }
  service.bind(
    EchoToken,
    (scopes) =>
      new (class NestedEcho {
        async where(scopeId: string) {
          if (scopes.get<{ nested?: boolean }>(scopeId).nested)
            return { threadId: 0, isMainThread: true, marker: 'nested-completed' };
          return withRemoteLeaseParent(scopes, scopeId, async () => {
            const child = await service.lease<DemoExecutor>('demo', { runId: 'child' });
            try {
              const childScope = child.openScope(
                { nested: true },
                {
                  workflowRunId: 'child',
                  workflowId: 'workflow',
                  workflowName: 'Child',
                  spaceId: 'default',
                  admittedChildren: new Set(),
                }
              );
              expect(await child.stub.bindingLabel()).not.toBe('1');
              const result = await child.stub.run({ scopeId: childScope });
              return { threadId: 0, isMainThread: true, marker: result.coordinator.marker };
            } finally {
              await child.release();
            }
          });
        }
      })()
  );
  try {
    await service.start('in_process');
    for (let index = 0; index < 12; index++) {
      const parent = await service.lease<DemoExecutor>('demo', { runId: 'parent' });
      try {
        expect(await parent.stub.bindingLabel()).toBe('1');
        const scopeId = parent.openScope(
          {},
          {
            workflowRunId: 'parent',
            workflowId: 'workflow',
            workflowName: 'Parent',
            spaceId: 'default',
            admittedChildren: new Set(),
          }
        );
        expect((await parent.stub.run({ scopeId })).coordinator.marker).toBe('nested-completed');
      } finally {
        await parent.release();
      }
      expect(Reflect.get(service, 'scopes').size).toBe(0);
      expect(Reflect.get(service, 'scopeControllers').size).toBe(0);
      expect(Reflect.get(service, 'leaseParentTokens').size).toBe(0);
    }
    expect(hosts).toBe(13);
  } finally {
    await service.stop();
  }
}, 15_000);

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { MessageChannel } from 'node:worker_threads';
import { expose, openPortSession } from '@kbn/core-remote-common';
import { restoreSandboxError } from './sandbox_errors';
import type { SandboxWorkspacesApi } from './sandbox_workspaces_tokens';
import { CortexHydrateStep } from './cortex_hydrate_step';
import type { SandboxPluginStart, SandboxSession } from '@kbn/sandbox-plugin/server';
import { DecisionTreeHydrateStep } from './decision_tree_hydrate_step';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { SandboxWorkspaces } from './sandbox_workspaces';
import { ObtainSandboxStep } from './obtain_sandbox_step';

const setup = (getSandboxStart: () => SandboxPluginStart | undefined = () => undefined) => {
  const controller = new AbortController();
  const scopes: ScopeLookup = {
    get: jest.fn(),
    getRunState: jest.fn().mockReturnValue({ spaceId: 'ops' }),
    resolveStepType: jest.fn(),
    resolveStepOutputLimit: jest.fn(),
    admitChild: jest.fn(),
    getAbortSignal: (scope) => {
      if (!['run', 'run2'].includes(scope)) throw new Error('Foreign run');
      return controller.signal;
    },
  };
  const allocate = jest.fn(async () => ({}));
  const workspaces = new SandboxWorkspaces(scopes, allocate, getSandboxStart, {
    isEnabled: () => true,
    reportHydrated: jest.fn(),
  });
  return { workspaces, scopes, allocate, controller };
};

it('allocates only through original infrastructure in the coordinator-owned Space', async () => {
  const { workspaces, allocate } = setup();
  await expect(workspaces.allocate('run', 'conversation', true)).resolves.toEqual({});
  expect(allocate).toHaveBeenCalledWith('ops', 'conversation', true);
});

it('refuses foreign, missing and closed scopes before touching sandbox infrastructure', async () => {
  const { workspaces, scopes, allocate, controller } = setup();
  await expect(workspaces.allocate('foreign', 'conversation', true)).rejects.toThrow('Foreign run');
  jest.mocked(scopes.getRunState).mockImplementationOnce(() => {
    throw new Error('Missing sidecar');
  });
  await expect(workspaces.allocate('run', 'conversation', true)).rejects.toThrow('Missing sidecar');
  controller.abort();
  await expect(workspaces.allocate('run', 'conversation', true)).rejects.toThrow();
  expect(allocate).not.toHaveBeenCalled();
});

it('does not serialize arbitrary infrastructure errors or result properties', async () => {
  const { workspaces, allocate } = setup();
  allocate.mockResolvedValueOnce({ skipped: true, apiKey: 'private' });
  await expect(workspaces.allocate('run', 'conversation', false)).resolves.toEqual({
    skipped: true,
  });
  allocate.mockRejectedValueOnce(
    Object.assign(new TypeError('Failed'), { authorization: 'private' })
  );
  const error = await workspaces.allocate('run', 'conversation', true).catch((failure) => failure);
  expect(error).toBeInstanceOf(TypeError);
  expect(error.authorization).toBeUndefined();
});

it('requires executor-local context before allocation', async () => {
  const { workspaces, allocate } = setup();
  await expect(new ObtainSandboxStep(workspaces).run('run', {}, {})).rejects.toThrow('context');
  expect(allocate).not.toHaveBeenCalled();
});

it('keeps workspace references run-owned, paths fenced, binary encoding exact, and closes references with the scope', async () => {
  const session: SandboxSession = {
    isReset: false,
    runCommand: jest.fn(),
    readFiles: jest.fn(),
    statFiles: jest.fn(),
    mkdirs: jest.fn(async () => [true]),
    writeFiles: jest.fn(async () => [{ bytes_written: 3, success: true }]),
  };
  const getSessionForSpace = jest.fn(() => session);
  const { workspaces, controller } = setup(() => ({ getSession: jest.fn(), getSessionForSpace }));
  const reference = await workspaces.openDecisionTreeWorkspace('run', 'conversation');
  expect(reference).toEqual(expect.any(String));
  if (!reference) throw new Error('Expected reference');
  expect(getSessionForSpace).toHaveBeenCalledWith('ops', 'conversation');
  await expect(workspaces.mkdirs('run2', reference, ['/workspace/decision-trees'])).rejects.toThrow(
    'Unknown sandbox workspace'
  );
  await expect(workspaces.mkdirs('run', 'unknown', ['/workspace/decision-trees'])).rejects.toThrow(
    'Unknown sandbox workspace'
  );
  for (const path of [
    '/workspace/elsewhere',
    '/workspace/decision-trees/../escape',
    '/workspace/decision-trees-other/file',
  ]) {
    await expect(workspaces.mkdirs('run', reference, [path])).rejects.toThrow('Path outside');
    await expect(
      workspaces.writeFiles('run', reference, [{ path, content: 'No' }])
    ).rejects.toThrow('Path outside');
  }
  expect(session.mkdirs).not.toHaveBeenCalled();
  expect(session.writeFiles).not.toHaveBeenCalled();
  await expect(workspaces.mkdirs('run', reference, ['/workspace/decision-trees'])).resolves.toEqual(
    [true]
  );
  await expect(
    workspaces.writeFiles('run', reference, [
      { path: '/workspace/decision-trees/tree.md', content: '£' },
    ])
  ).resolves.toEqual([{ bytes_written: 3, success: true }]);
  expect(session.writeFiles).toHaveBeenCalledWith([
    { path: '/workspace/decision-trees/tree.md', content: Buffer.from('£', 'utf8') },
  ]);
  expect(session.runCommand).not.toHaveBeenCalled();
  controller.abort();
  await expect(
    workspaces.mkdirs('run', reference, ['/workspace/decision-trees'])
  ).rejects.toThrow();
  expect(session.mkdirs).toHaveBeenCalledTimes(1);
});

it('retains the original unavailable-plugin branch and refuses missing local hydration context', async () => {
  const { workspaces } = setup();
  await expect(
    workspaces.openDecisionTreeWorkspace('run', 'conversation')
  ).resolves.toBeUndefined();
  const policy = { read: jest.fn() };
  await expect(new DecisionTreeHydrateStep(workspaces, policy).run('run', {}, {})).rejects.toThrow(
    'context'
  );
  expect(policy.read).not.toHaveBeenCalled();
});

it('preserves only the original UNAVAILABLE retry fact over real RPC, never private metadata', async () => {
  const { workspaces, allocate } = setup();
  const original = Object.assign(new Error('Sandbox unavailable'), {
    code: 14,
    authorization: 'private',
  });
  allocate.mockRejectedValueOnce(original);
  const { port1, port2 } = new MessageChannel();
  try {
    const remote = openPortSession<SandboxWorkspacesApi>(port1);
    openPortSession(port2, expose(workspaces));
    try {
      await restoreSandboxError(remote.allocate('run', 'conversation', true));
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ message: 'Sandbox unavailable', code: 14 });
      expect(error).not.toHaveProperty('authorization');
    }
    const nonRetryable = Object.assign(new Error('Other failure'), {
      code: 13,
      authorization: 'private',
    });
    allocate.mockRejectedValueOnce(nonRetryable);
    await expect(
      restoreSandboxError(remote.allocate('run', 'conversation', true))
    ).rejects.not.toHaveProperty('code');
  } finally {
    port1.close();
    port2.close();
  }
});

it('fences Cortex paths and telemetry by the original run-owned workspace reference', async () => {
  const session: SandboxSession = {
    isReset: false,
    runCommand: jest.fn(),
    readFiles: jest.fn(),
    statFiles: jest.fn(),
    mkdirs: jest.fn(),
    writeFiles: jest.fn(),
  };
  const { scopes, allocate } = setup();
  const reportHydrated = jest.fn();
  const workspaces = new SandboxWorkspaces(
    scopes,
    allocate,
    () => ({ getSession: jest.fn(), getSessionForSpace: () => session }),
    { isEnabled: () => true, reportHydrated }
  );
  const reference = await workspaces.openCortexWorkspace(
    'run',
    'conversation',
    'telemetry-conversation'
  );
  if (!reference) throw new Error('Expected reference');
  await expect(workspaces.isCortexEnabled('run')).resolves.toBe(true);
  await workspaces.reportCortexHydrated('run', reference, [
    { entity_type: 'service', workflow_execution_id: 'forged' } as { entity_type: 'service' },
  ]);
  expect(reportHydrated).toHaveBeenCalledWith('telemetry-conversation', [
    { entity_type: 'service' },
  ]);
  await expect(workspaces.reportCortexHydrated('run2', reference, [])).rejects.toThrow(
    'Unknown sandbox workspace'
  );
  const treeReference = await workspaces.openDecisionTreeWorkspace('run', 'conversation');
  if (!treeReference) throw new Error('Expected tree reference');
  await expect(workspaces.reportCortexHydrated('run', treeReference, [])).rejects.toThrow(
    'Not a Cortex'
  );
  await expect(workspaces.mkdirs('run', reference, ['/workspace/decision-trees'])).rejects.toThrow(
    'Path outside'
  );
  await expect(workspaces.mkdirs('run', treeReference, ['/workspace/cortex'])).rejects.toThrow(
    'Path outside'
  );
  expect(session.mkdirs).not.toHaveBeenCalled();
  await expect(new CortexHydrateStep(workspaces).run('run', {}, {})).rejects.toThrow('context');
});

it('exports only the narrow capability surface, not TypeScript-private implementation helpers', () => {
  const { workspaces } = setup();
  const adapter = expose(workspaces);
  expect(Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)).sort()).toEqual([
    'allocate',
    'constructor',
    'isCortexEnabled',
    'mkdirs',
    'openCortexWorkspace',
    'openDecisionTreeWorkspace',
    'reportCortexHydrated',
    'writeFiles',
  ]);
  for (const name of [
    'perform',
    'openWorkspace',
    'getWorkspace',
    'getSession',
    'assertTreePath',
    'assertWorkspacePath',
    'runCommand',
  ]) {
    expect(name in adapter).toBe(false);
  }
});

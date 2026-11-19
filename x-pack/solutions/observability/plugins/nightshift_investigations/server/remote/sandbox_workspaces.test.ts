/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

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
  const workspaces = new SandboxWorkspaces(scopes, allocate, getSandboxStart);
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

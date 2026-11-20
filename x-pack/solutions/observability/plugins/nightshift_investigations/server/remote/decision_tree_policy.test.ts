/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { expose } from '@kbn/core-remote-common';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { DecisionTreePolicy } from './decision_tree_policy';
import { DecisionTreePrepareStep } from './decision_tree_prepare_step';

const setup = () => {
  const controller = new AbortController();
  const scopes: ScopeLookup = {
    get: jest.fn(),
    getRunState: jest.fn(),
    resolveStepType: jest.fn(),
    resolveStepOutputLimit: jest.fn(),
    getRunDefinitionFacts: jest.fn(() => ({})),
    admitChild: jest.fn(),
    getAbortSignal: (scope) => {
      if (scope !== 'run') throw new Error('Foreign run');
      return controller.signal;
    },
  };
  const getPolicy = jest.fn().mockReturnValue({
    enabled: true,
    telemetryConnectorId: 'public-connector',
    privateConfig: 'fake-private',
  });
  const policy = new DecisionTreePolicy(scopes, getPolicy);
  return { policy, controller, scopes, getPolicy };
};

it('returns only current nonsecret policy facts, without a cross-step or cross-run cache', async () => {
  const { policy, getPolicy } = setup();
  await expect(policy.read('run')).resolves.toEqual({
    enabled: true,
    telemetryConnectorId: 'public-connector',
  });
  getPolicy.mockReturnValueOnce({ enabled: false });
  await expect(policy.read('run')).resolves.toEqual({ enabled: false });
  expect(getPolicy).toHaveBeenCalledTimes(2);
  expect('invoke' in expose(policy)).toBe(false);
});

it('refuses foreign/closed scopes and unknown sidecars before reading config', async () => {
  const { policy, controller, scopes, getPolicy } = setup();
  await expect(policy.read('foreign')).rejects.toThrow('Foreign run');
  jest.mocked(scopes.getRunState).mockImplementationOnce(() => {
    throw new Error('Missing sidecar');
  });
  await expect(policy.read('run')).rejects.toThrow('Missing sidecar');
  controller.abort();
  await expect(policy.read('run')).rejects.toThrow();
  expect(getPolicy).not.toHaveBeenCalled();
});

it('requires executor-local context before requesting policy', async () => {
  const { policy, getPolicy } = setup();
  await expect(new DecisionTreePrepareStep(policy).run('run', {}, {})).rejects.toThrow('context');
  expect(getPolicy).not.toHaveBeenCalled();
});

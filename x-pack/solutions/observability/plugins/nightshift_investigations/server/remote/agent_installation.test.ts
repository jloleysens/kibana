/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ScopeLookup } from '@kbn/core-remote-server';
import { AgentInstallation } from './agent_installation';
import { EnsureInvestigationAgentStep } from './ensure_investigation_agent_step';

const setup = () => {
  const controller = new AbortController();
  const scopes: ScopeLookup = {
    get: jest.fn(),
    getRunState: jest.fn().mockReturnValue({ spaceId: 'ops' }),
    resolveStepType: jest.fn(),
    resolveStepOutputLimit: jest.fn(),
    getRunDefinitionFacts: jest.fn(() => ({})),
    admitChild: jest.fn(),
    getAbortSignal: (scope) => {
      if (scope !== 'run') throw new Error('Foreign run');
      return controller.signal;
    },
  };
  const install = jest.fn(async () => {});
  const agents = new AgentInstallation(scopes, install);
  return { agents, scopes, install, controller };
};

it.each(['nightshift.investigation', 'significant-events.decision-tree-reinforcement'] as const)(
  'installs only the original built-in %s in the trusted scope Space',
  async (agentId) => {
    const { agents, install } = setup();
    await agents.ensure('run', agentId);
    expect(install).toHaveBeenCalledWith('ops', agentId);
  }
);

it('refuses arbitrary agent ids, foreign/closed scopes and missing sidecars before installation', async () => {
  const { agents, scopes, install, controller } = setup();
  await expect(agents.ensure('run', 'foreign-agent' as never)).rejects.toThrow(
    'Unknown Nightshift agent'
  );
  await expect(agents.ensure('foreign', 'nightshift.investigation')).rejects.toThrow('Foreign run');
  jest.mocked(scopes.getRunState).mockImplementationOnce(() => {
    throw new Error('Missing sidecar');
  });
  await expect(agents.ensure('run', 'nightshift.investigation')).rejects.toThrow('Missing sidecar');
  controller.abort();
  await expect(agents.ensure('run', 'nightshift.investigation')).rejects.toThrow();
  expect(install).not.toHaveBeenCalled();
});

it('requires local context before installing', async () => {
  const { agents, install } = setup();
  await expect(new EnsureInvestigationAgentStep(agents).run('run', {}, {})).rejects.toThrow(
    'context'
  );
  expect(install).not.toHaveBeenCalled();
});

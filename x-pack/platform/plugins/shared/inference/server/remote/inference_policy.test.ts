/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { httpServerMock } from '@kbn/core/server/mocks';
import type { InferencePolicy } from './tokens';
import { InferencePolicyCapability, getWorkerConnectorDescriptors } from './inference_policy';

const policy = (): InferencePolicy => ({
  namespace: 'run-space',
  rules: [{ type: 'RegExp', enabled: true, pattern: 'private', entityClass: 'EMAIL' }],
  onFailure: 'block',
  defaultConnector: 'default',
  defaultOnly: false,
  tokenUsageTracking: false,
  streaming: true,
  regexWorkerEnabled: true,
  stackConnectors: [],
});

const setup = () => {
  const request = httpServerMock.createKibanaRequest();
  const controller = new AbortController();
  const read = jest.fn(async () => policy());
  const regex = jest.fn(async () => []);
  const scopes = {
    get: jest.fn().mockImplementation((scope: string) => {
      if (scope !== 'run') throw new Error('Foreign scope');
      return request;
    }),
    getRunState: jest.fn(),
    getRunDefinitionFacts: jest.fn(),
    resolveStepType: jest.fn(),
    resolveStepOutputLimit: jest.fn(),
    admitChild: jest.fn(),
    getAbortSignal: (scope: string) => {
      if (scope !== 'run') throw new Error('Foreign scope');
      return controller.signal;
    },
  };
  const capability = new InferencePolicyCapability(scopes, read, regex);
  return { capability, request, read, regex, controller };
};

it('reads only with the owning request and snapshots admitted rules', async () => {
  const { capability, read, request, regex } = setup();
  const admitted = await capability.read('run');
  expect(read).toHaveBeenCalledWith(request);
  const payload = {
    rules: policy().rules.filter((rule) => rule.type === 'RegExp'),
    records: [{ value: 'private' }],
  };
  admitted?.rules.splice(0);
  await expect(capability.runRegexRules('run', payload)).resolves.toEqual([]);
  expect(regex).toHaveBeenCalledWith('run', payload);
  await expect(capability.read('foreign')).rejects.toThrow('Foreign scope');
  expect(read).toHaveBeenCalledTimes(1);
});

it('refuses rules not admitted by the run policy and calls before policy admission', async () => {
  const { capability, regex } = setup();
  const payload = {
    rules: policy().rules.filter((rule) => rule.type === 'RegExp'),
    records: [{ value: 'private' }],
  };
  await expect(capability.runRegexRules('run', payload)).rejects.toThrow('inference lease');
  await capability.read('run');
  payload.rules[0].pattern = 'unconfigured';
  await expect(capability.runRegexRules('run', payload)).rejects.toThrow('inference lease');
  expect(regex).not.toHaveBeenCalled();
});

it('preserves original regex failure and refuses a closed scope', async () => {
  const { capability, controller, regex } = setup();
  await capability.read('run');
  const payload = {
    rules: policy().rules.filter((rule) => rule.type === 'RegExp'),
    records: [{ value: 'private' }],
  };
  const failure = new Error('Anonymization patterns timed out after 15s');
  regex.mockRejectedValueOnce(failure);
  await expect(capability.runRegexRules('run', payload)).rejects.toBe(failure);
  controller.abort(new Error('Scope closed'));
  await expect(capability.runRegexRules('run', payload)).rejects.toThrow('Aborted');
  await expect(capability.read('run')).rejects.toThrow('Aborted');
  expect(regex).toHaveBeenCalledTimes(1);
});

it('rejects a policy response if its scope closed while awaiting it', async () => {
  const { capability, controller, read } = setup();
  read.mockImplementationOnce(async () => {
    controller.abort(new Error('Scope closed'));
    return policy();
  });
  await expect(capability.read('run')).rejects.toThrow('Aborted');
});

it('exports only connector selection metadata, never unrelated config or injected secret fields', () => {
  const connector = {
    id: 'connector',
    name: 'selected',
    actionTypeId: '.gen-ai',
    config: { apiUrl: 'not-exported', apiKey: 'not-exported' },
    secrets: { apiKey: 'not-exported' },
    isPreconfigured: false,
    isDeprecated: false,
    isConnectorTypeDeprecated: false,
    isSystemAction: false,
    referencedByCount: 0,
  };
  const descriptors = getWorkerConnectorDescriptors([
    connector,
    {
      ...connector,
      id: 'alias',
      actionTypeId: '.inference',
      config: { inferenceId: 'endpoint', taskType: 'chat_completion', apiKey: 'not-exported' },
    },
    { ...connector, actionTypeId: '.unrelated' },
  ]);
  expect(descriptors).toHaveLength(2);
  expect(descriptors[0].config).toEqual({});
  expect(descriptors[1].config).toEqual({ inferenceId: 'endpoint', taskType: 'chat_completion' });
  expect(JSON.stringify(descriptors)).not.toMatch(/not-exported|secrets|apiUrl|apiKey/);
});

it('preserves only public scalar model-selection facts needed by original legacy adapters', () => {
  const [descriptor] = getWorkerConnectorDescriptors([
    {
      id: 'legacy',
      name: 'Legacy',
      actionTypeId: '.gen-ai',
      config: {
        apiProvider: 'OpenAI',
        defaultModel: 'gpt-4o',
        contextWindowLength: 4096,
        temperature: 0.2,
        enableNativeFunctionCalling: true,
        headers: { authorization: 'secret' },
        apiUrl: 'secret',
        providerConfig: { model_id: 'model', api_key: 'secret' },
      },
      isPreconfigured: false,
      isDeprecated: false,
      isConnectorTypeDeprecated: false,
      isSystemAction: false,
      referencedByCount: 0,
    },
  ]);
  expect(descriptor.config).toEqual({
    apiProvider: 'OpenAI',
    defaultModel: 'gpt-4o',
    contextWindowLength: 4096,
    temperature: 0.2,
    enableNativeFunctionCalling: true,
    providerConfig: { model_id: 'model' },
  });
  expect(JSON.stringify(descriptor)).not.toMatch(/secret|headers|authorization|api_key|apiUrl/);
});

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { actionsConfigMock } from '@kbn/actions-plugin/server/actions_config.mock';
import type { SubActionServices } from '@kbn/actions-plugin/server/sub_action_framework/types';
import { actionsMock } from '@kbn/actions-plugin/server/mocks';
import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { OpenAiProviderType } from '@kbn/connector-schemas/openai';
import { OpenAIConnector } from '../connector_types/openai/openai';
import { BedrockConnector } from '../connector_types/bedrock/bedrock';
import { createOpenAIClient } from '../connector_types/openai/openai_sdk';
import { createBedrockClient } from '../connector_types/bedrock/bedrock_sdk';

jest.mock('../connector_types/openai/openai_sdk', () => ({
  createOpenAIClient: jest.fn((options: Parameters<typeof createOpenAIClient>[0]) =>
    jest
      .requireActual<typeof import('../connector_types/openai/openai_sdk')>(
        '../connector_types/openai/openai_sdk'
      )
      .createOpenAIClient({ ...options, dangerouslyAllowBrowser: true })
  ),
}));
jest.mock('../connector_types/bedrock/bedrock_sdk', () => ({
  createBedrockClient: jest.fn(
    jest.requireActual('../connector_types/bedrock/bedrock_sdk').createBedrockClient
  ),
}));

const setup = () => {
  const common = {
    logger: loggingSystemMock.createLogger(),
    services: actionsMock.createServices(),
    configurationUtilities: actionsConfigMock.create(),
  };
  return {
    openai: new OpenAIConnector({
      ...common,
      connector: { id: 'openai', type: '.gen-ai' },
      config: {
        apiProvider: OpenAiProviderType.OpenAi,
        apiUrl: 'http://127.0.0.1/v1/chat/completions',
      },
      secrets: { apiKey: 'fake' },
    }),
    bedrock: new BedrockConnector({
      ...common,
      connector: { id: 'bedrock', type: '.bedrock' },
      config: { apiUrl: 'http://127.0.0.1', region: 'us-east-1' },
      secrets: { accessKey: 'fake', secret: 'fake' },
    }),
  };
};

beforeEach(() => jest.clearAllMocks());

it('does not construct either vendor SDK while constructing the thin connectors', () => {
  setup();
  expect(createOpenAIClient).not.toHaveBeenCalled();
  expect(createBedrockClient).not.toHaveBeenCalled();
});

it('shares first-use construction across concurrent calls and retains the warm clients', async () => {
  const { openai, bedrock } = setup();
  const openaiClients = await Promise.all([
    openai['getOpenAIClient'](),
    openai['getOpenAIClient'](),
  ]);
  const bedrockClients = await Promise.all([
    bedrock['getBedrockClient'](),
    bedrock['getBedrockClient'](),
  ]);
  expect(openaiClients[0]).toBe(openaiClients[1]);
  expect(bedrockClients[0]).toBe(bedrockClients[1]);
  expect(await openai['getOpenAIClient']()).toBe(openaiClients[0]);
  expect(await bedrock['getBedrockClient']()).toBe(bedrockClients[0]);
  expect(createOpenAIClient).toHaveBeenCalledTimes(1);
  expect(createBedrockClient).toHaveBeenCalledTimes(1);
  bedrockClients[0].destroy();
});

it('does not poison either connector after failed first-use construction', async () => {
  jest.mocked(createOpenAIClient).mockImplementationOnce(() => {
    throw new Error('openai construction');
  });
  jest.mocked(createBedrockClient).mockImplementationOnce(() => {
    throw new Error('bedrock construction');
  });
  const { openai, bedrock } = setup();
  await expect(openai['getOpenAIClient']()).rejects.toThrow('openai construction');
  await expect(bedrock['getBedrockClient']()).rejects.toThrow('bedrock construction');
  await expect(openai['getOpenAIClient']()).resolves.toBeDefined();
  const client = await bedrock['getBedrockClient']();
  expect(createOpenAIClient).toHaveBeenCalledTimes(2);
  expect(createBedrockClient).toHaveBeenCalledTimes(2);
  client.destroy();
});

it.each([
  [{ enabled: true }, true],
  [{ enabled: false, services: [] }, true],
  [
    {
      enabled: false,
      services: [{ service: 'openai', features: { non_streaming_chat: { supported: true } } }],
    },
    false,
  ],
])(
  'retains the original inference streaming decision for coordinator-resolved facts %j',
  async (inferenceStreamingFacts, expected) => {
    const { InferenceConnector } = await import('../connector_types/inference/inference');
    const connector = new InferenceConnector<SubActionServices>({
      logger: loggingSystemMock.createLogger(),
      services: { ...actionsMock.createServices(), inferenceStreamingFacts },
      configurationUtilities: actionsConfigMock.create(),
      connector: { id: 'inference', type: '.inference' },
      config: {
        provider: 'openai',
        inferenceId: 'fake',
        taskType: 'chat_completion',
        providerConfig: {},
      },
      secrets: { providerSecrets: {} },
    });
    expect(await connector['shouldStream']()).toBe(expected);
  }
);

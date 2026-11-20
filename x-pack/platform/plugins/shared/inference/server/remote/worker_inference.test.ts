/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { Client, HttpConnection } from '@elastic/elasticsearch';
import { loggerMock } from '@kbn/logging-mocks';
import { httpServerMock } from '@kbn/core/server/mocks';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { InferencePolicy, InferencePolicyApi } from './tokens';
import { createWorkerInference, UncarvedInferenceBacking } from './worker_inference';

const policy = (): InferencePolicy => ({
  namespace: 'run-space',
  rules: [],
  onFailure: 'block',
  defaultConnector: 'endpoint',
  defaultOnly: false,
  tokenUsageTracking: false,
  streaming: false,
  regexWorkerEnabled: true,
  stackConnectors: [],
});

describe('createWorkerInference using the original client and chat model', () => {
  let server: Server;
  let client: Client;
  let paths: string[];
  const endpoint = {
    inference_id: 'endpoint',
    task_type: 'chat_completion',
    service: 'openai',
    service_settings: { model_id: 'gpt-4o' },
  };

  beforeEach(async () => {
    paths = [];
    server = createServer(async (request, response) => {
      paths.push(`${request.method} ${request.url}`);
      let text = '';
      for await (const chunk of request) text += chunk;
      response.setHeader('x-elastic-product', 'Elasticsearch');
      response.setHeader('content-type', 'application/json');
      if (request.method === 'GET' && request.url === '/_inference/_services') {
        response.end(
          JSON.stringify([
            { service: 'openai', features: { non_streaming_chat: { supported: true } } },
          ])
        );
      } else if (request.method === 'GET') {
        response.end(JSON.stringify({ endpoints: [endpoint] }));
      } else {
        response.end(
          JSON.stringify({
            id: 'local-fake',
            model: 'gpt-4o',
            object: 'chat.completion',
            created: 1,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Persistable inference result' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
          })
        );
      }
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fake address');
    client = new Client({ Connection: HttpConnection, node: `http://127.0.0.1:${address.port}` });
  });

  afterEach(async () => {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  const create = (snapshot = policy()) => {
    const capability: InferencePolicyApi = {
      read: jest.fn(),
      runRegexRules: jest.fn(async () => []),
    };
    return createWorkerInference({
      scopeId: 'scope',
      policy: snapshot,
      capability,
      internalClient: client as ElasticsearchClient,
      userClient: client as ElasticsearchClient,
      logger: loggerMock.create(),
    });
  };

  it('resolves and invokes a real native inference endpoint with original token metadata', async () => {
    const inference = create();
    const request = httpServerMock.createKibanaRequest();
    expect((await inference.getDefaultConnector(request))?.connectorId).toBe('endpoint');
    const model = await inference.getChatModel({
      request,
      connectorId: 'endpoint',
      chatModelOptions: { maxRetries: 0 },
    });
    const result = await model.invoke([{ role: 'user', content: 'A local business record' }]);
    expect(result.content).toBe('Persistable inference result');
    expect(result.usage_metadata).toMatchObject({ input_tokens: 3, output_tokens: 2 });
    expect(paths).toContain('GET /_inference/_services');
    expect(
      paths.some((path) => path.startsWith('POST /_inference/chat_completion/endpoint?'))
    ).toBe(true);
  });

  it('keeps native endpoints available when the scoped Actions list is forbidden', async () => {
    const inference = create({ ...policy(), stackConnectors: { error: 'Forbidden' } });
    const connector = await inference.getConnectorById(
      'endpoint',
      httpServerMock.createKibanaRequest()
    );
    expect(connector.isInferenceEndpoint).toBe(true);
  });

  it('retains stack-backed placement before any LLM call', async () => {
    const inference = create({
      ...policy(),
      stackConnectors: [
        {
          id: 'legacy',
          name: 'Legacy',
          actionTypeId: '.gen-ai',
          config: { apiProvider: 'OpenAI' },
          isPreconfigured: false,
          isDeprecated: false,
          isConnectorTypeDeprecated: false,
          isSystemAction: false,
          referencedByCount: 0,
        },
      ],
    });
    await expect(
      inference.getChatModel({
        request: httpServerMock.createKibanaRequest(),
        connectorId: 'legacy',
        chatModelOptions: {},
      })
    ).rejects.toBeInstanceOf(UncarvedInferenceBacking);
    expect(paths.every((path) => path.startsWith('GET '))).toBe(true);
  });
});

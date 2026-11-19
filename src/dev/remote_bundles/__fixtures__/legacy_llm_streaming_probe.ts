/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License, v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { connect } from 'node:net';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAiProviderType } from '@kbn/connector-schemas/openai';
import { Client } from '@elastic/elasticsearch';
import { ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { EventStreamCodec } from '@smithy/eventstream-codec';
import { fromUtf8, toUtf8 } from '@smithy/util-utf8';
import { getConnectorType as openai } from '@kbn/stack-connectors-plugin/server/connector_types/openai/get_connector_type';
import { getConnectorType as bedrock } from '@kbn/stack-connectors-plugin/server/connector_types/bedrock/get_connector_type';
import { getConnectorType as gemini } from '@kbn/stack-connectors-plugin/server/connector_types/gemini/get_connector_type';
import { getConnectorType as inference } from '@kbn/stack-connectors-plugin/server/connector_types/inference';
import { buildExecutor } from '@kbn/actions-plugin/server/sub_action_framework/executor';
import { configSchema } from '@kbn/actions-plugin/server/config';
import { getActionsConfigurationUtilities } from '@kbn/actions-plugin/server/actions_config';
import { ConnectorUsageCollector } from '@kbn/actions-plugin/server/usage/connector_usage_collector';
import type { SubActionServices } from '@kbn/actions-plugin/server/sub_action_framework/types';
import type { Logger } from '@kbn/core/server';

const main = async (): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), 'llm-streaming-'));
  const awsHost = 'bedrock-runtime.us-east-1.amazonaws.com';
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(directory, 'key.pem'),
      '-out',
      join(directory, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=local-llm-streaming',
      '-addext',
      `subjectAltName=DNS:${awsHost}`,
    ],
    { stdio: 'ignore' }
  );
  const marker = 'native-streaming-business-marker';
  const codec = new EventStreamCodec(toUtf8, fromUtf8);
  let requests = 0;
  const http = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    requests++;
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'x-elastic-product': 'Elasticsearch',
    });
    const data = request.url?.includes(':streamGenerateContent')
      ? {
          candidates: [{ content: { parts: [{ text: marker }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        }
      : {
          id: 'fake',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fake',
          choices: [{ index: 0, delta: { content: marker }, finish_reason: 'stop' }],
        };
    response.end(`data: ${JSON.stringify(data)}\n\ndata: [DONE]\n\n`);
  });
  const tls = createTlsServer(
    {
      key: readFileSync(join(directory, 'key.pem')),
      cert: readFileSync(join(directory, 'cert.pem')),
    },
    async (request, response) => {
      for await (const chunk of request) void chunk;
      requests++;
      assert.match(request.headers.authorization ?? '', /^AWS4-HMAC-SHA256 /);
      response.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' });
      const frame = (event: string, body: object) =>
        codec.encode({
          headers: {
            ':event-type': { type: 'string', value: event },
            ':message-type': { type: 'string', value: 'event' },
            ':content-type': { type: 'string', value: 'application/json' },
          },
          body: fromUtf8(JSON.stringify(body)),
        });
      response.write(frame('contentBlockDelta', { contentBlockIndex: 0, delta: { text: marker } }));
      setTimeout(
        () =>
          response.end(
            frame('metadata', { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } })
          ),
        20
      );
    }
  );
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  await new Promise<void>((done) => tls.listen(0, '127.0.0.1', done));
  const httpAddress = http.address();
  const tlsAddress = tls.address();
  assert(
    httpAddress && typeof httpAddress !== 'string' && tlsAddress && typeof tlsAddress !== 'string'
  );
  const proxy = createServer();
  proxy.on('connect', (request, socket, head) => {
    assert.equal(request.url, awsHost + ':443');
    const upstream = connect(tlsAddress.port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
  });
  await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
  const proxyAddress = proxy.address();
  assert(proxyAddress && typeof proxyAddress !== 'string');
  const url = `http://127.0.0.1:${httpAddress.port}`;
  const configurationUtilities = getActionsConfigurationUtilities(
    configSchema.validate({
      allowedHosts: ['127.0.0.1', awsHost],
      proxyUrl: `http://127.0.0.1:${proxyAddress.port}`,
      proxyOnlyHosts: [awsHost],
      customHostSettings: [
        {
          url: 'https://' + awsHost + ':443',
          ssl: {
            verificationMode: 'full',
            certificateAuthoritiesData: readFileSync(join(directory, 'cert.pem'), 'utf8'),
          },
        },
      ],
    })
  );
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    trace() {},
    fatal() {},
    log() {},
    isLevelEnabled: () => false,
    get: () => logger,
  };
  const client = new Client({ node: url });
  const services: SubActionServices = {
    scopedClusterClient: client,
    savedObjectsClient: {
      get: async <T>() => ({ id: 'fake', type: 'dashboard', references: [], attributes: {} as T }),
      create: async <T>(_type: string, attributes: T) => ({
        id: 'fake',
        type: 'dashboard',
        references: [],
        attributes,
      }),
    },
    connectorTokenClient: {
      get: async () => ({ hasErrors: false, connectorToken: null }),
      updateOrReplace: async () => {},
      deleteConnectorTokens: async () => {},
      updateWithRefreshToken: async () => null,
    },
  };
  // Gemini uses the existing cached-token path here; real JWT acquisition has separate persisted proofs.
  const geminiServices: SubActionServices = {
    ...services,
    connectorTokenClient: {
      ...services.connectorTokenClient,
      get: async () => ({
        hasErrors: false,
        connectorToken: {
          id: 'fake',
          connectorId: 'fake',
          tokenType: 'access_token',
          profileUid: 'fake-user',
          credentialType: 'oauth',
          credentials: {},
          updatedAt: new Date().toISOString(),
          token: 'fake',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      }),
    },
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const drain = async (stream: AsyncIterable<object | string | Uint8Array>): Promise<string> => {
    let text = '';
    let bytes = 0;
    for await (const chunk of stream) {
      controller.signal.throwIfAborted();
      const part =
        chunk instanceof Uint8Array
          ? Buffer.from(chunk).toString()
          : typeof chunk === 'string'
          ? chunk
          : JSON.stringify(chunk);
      bytes += Buffer.byteLength(part);
      if (bytes > 128 * 1024) {
        controller.abort();
        throw new Error('Streaming fixture output limit exceeded');
      }
      text += part;
    }
    assert(text.includes(marker), text);
    return text;
  };
  const common = {
    actionId: 'fake',
    configurationUtilities,
    logger,
    services,
    connectorUsageCollector: new ConnectorUsageCollector({ logger, connectorId: 'fake' }),
  };
  try {
    const ai = await buildExecutor({
      connector: openai<SubActionServices>(),
      configurationUtilities,
      logger,
      signal: controller.signal,
    })({
      ...common,
      config: {
        apiUrl: url + '/v1/chat/completions',
        apiProvider: OpenAiProviderType.Other,
        defaultModel: 'fake',
      },
      secrets: { apiKey: 'fake' },
      params: {
        subAction: 'invokeAsyncIterator',
        subActionParams: { messages: [{ role: 'user', content: 'marker' }], timeout: 5000 },
      },
    });
    const aiData = ai.data as {
      consumerStream: AsyncIterable<object>;
      tokenCountStream: AsyncIterable<object>;
    };
    await Promise.all([drain(aiData.consumerStream), drain(aiData.tokenCountStream)]);
    const br = await buildExecutor({
      connector: bedrock<SubActionServices>(),
      configurationUtilities,
      logger,
      signal: controller.signal,
    })({
      ...common,
      config: { apiUrl: 'https://' + awsHost, region: 'us-east-1', defaultModel: 'fake' },
      secrets: { accessKey: 'fake', secret: 'fake' },
      params: {
        subAction: 'bedrockClientSend',
        subActionParams: {
          command: new ConverseStreamCommand({
            modelId: 'fake',
            messages: [{ role: 'user', content: [{ text: 'marker' }] }],
          }),
        },
      },
    });
    const brData = br.data as { stream: AsyncIterable<object>; tokenStream: AsyncIterable<object> };
    await Promise.all([drain(brData.stream), drain(brData.tokenStream)]);
    const gm = await buildExecutor({
      connector: gemini<SubActionServices>(),
      configurationUtilities,
      logger,
      signal: controller.signal,
    })({
      ...common,
      services: geminiServices,
      config: { apiUrl: url, gcpProjectID: 'fake', gcpRegion: 'fake', defaultModel: 'fake' },
      secrets: { credentialsJson: JSON.stringify({ type: 'service_account' }) },
      params: {
        subAction: 'invokeStream',
        subActionParams: { messages: [{ role: 'user', content: 'marker' }], timeout: 5000 },
      },
    });
    await drain(gm.data as AsyncIterable<Uint8Array>);
    const inf = await buildExecutor({
      connector: inference<SubActionServices>(),
      configurationUtilities,
      logger,
      signal: controller.signal,
    })({
      ...common,
      config: {
        inferenceId: 'fake',
        provider: 'openai',
        taskType: 'chat_completion',
        providerConfig: {},
      },
      secrets: { providerSecrets: {} },
      params: {
        subAction: 'unified_completion_async_iterator',
        subActionParams: { body: { messages: [{ role: 'user', content: 'marker' }] } },
      },
    });
    const infData = inf.data as {
      consumerStream: AsyncIterable<object>;
      tokenCountStream: AsyncIterable<object>;
    };
    await Promise.all([drain(infData.consumerStream), drain(infData.tokenCountStream)]);
    assert.equal(requests, 4);
    process.stdout.write(
      JSON.stringify({
        pid: process.pid,
        marker,
        requests,
        types: ['gen-ai', 'bedrock', 'gemini', 'inference'],
        drainedBranches: [2, 2, 1, 2],
        scope: 'native streaming execution capability (fixture), NOT a new workflow output API',
      })
    );
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await client.close();
    http.closeAllConnections();
    http.close();
    tls.closeAllConnections();
    tls.close();
    proxy.closeAllConnections();
    proxy.close();
    rmSync(directory, { recursive: true, force: true });
  }
};
void main().catch((error: Error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { inject } from 'inversify';
import { Client, HttpConnection } from '@elastic/elasticsearch';
import type { KibanaRequest, Logger, ElasticsearchClient } from '@kbn/core/server';
import { SpecRuntimeToken } from '@kbn/actions-plugin/server/remote/tokens';
import type { SpecRuntime } from '@kbn/actions-plugin/server/remote/spec_runtime';
import type { LocalConnectorExecution } from '@kbn/actions-plugin/server/remote/local_execution';
import { createWorkerInference } from '@kbn/inference-plugin/server/remote/worker_inference';
import { executeLegacyInferenceAction } from '@kbn/inference-workflows-plugin/server/remote/execute_legacy_action';
export class StreamProbe {
  constructor(@inject(SpecRuntimeToken) private readonly runtime: SpecRuntime) {}
  async run(scopeId: string, node: string): Promise<{ content: string; pid: number }> {
    const client = new Client({ Connection: HttpConnection, node });
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
    const executions: LocalConnectorExecution[] = [];
    const data = {
      internal: () => client as ElasticsearchClient,
      user: () => client as ElasticsearchClient,
    };
    try {
      const inference = createWorkerInference({
        scopeId,
        internalClient: data.internal(),
        userClient: data.user(),
        logger,
        policy: {
          namespace: 'default',
          rules: [],
          onFailure: 'block',
          defaultConnector: 'legacy',
          defaultOnly: false,
          tokenUsageTracking: false,
          streaming: true,
          regexWorkerEnabled: false,
          stackConnectors: [
            {
              id: 'legacy',
              name: 'Legacy',
              actionTypeId: '.gen-ai',
              config: { apiProvider: 'OpenAI', defaultModel: 'gpt-4o' },
              isPreconfigured: false,
              isDeprecated: false,
              isConnectorTypeDeprecated: false,
              isSystemAction: false,
              referencedByCount: 0,
            },
          ],
        },
        capability: { read: async () => null, runRegexRules: async () => [] },
        executeAction: async (options) => {
          const execution = await executeLegacyInferenceAction({
            options,
            runtime: this.runtime,
            data,
            scopeId,
            signal: new AbortController().signal,
          });
          executions.push(execution);
          return execution.result;
        },
      });
      const model = await inference.getChatModel({
        connectorId: 'legacy',
        request: {} as KibanaRequest,
        chatModelOptions: { maxRetries: 0 },
      });
      let content = '';
      for await (const chunk of await model.stream([
        { role: 'user', content: 'Local live stream' },
      ]))
        content += chunk.content;
      await Promise.all(executions.map((execution) => execution.finalize()));
      await this.runtime.drain(scopeId);
      return { content, pid: process.pid };
    } finally {
      await this.runtime.close(scopeId);
      await client.close();
    }
  }
}

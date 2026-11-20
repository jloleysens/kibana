/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ActionsClient } from '@kbn/actions-plugin/server';
import { isSupportedConnector } from '@kbn/inference-common';
import type { KibanaRequest } from '@kbn/core/server';
import { recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import type { ScopeLookup } from '@kbn/core-remote-server';
import type { InferencePolicy, InferencePolicyApi } from './tokens';

/** Exposes scoped policy and the original isolated regex helper, never an inference handler. */
@remotable()
export class InferencePolicyCapability implements InferencePolicyApi {
  private readonly policies = new Map<string, InferencePolicy>();

  constructor(
    private readonly scopes: ScopeLookup,
    private readonly readPolicy: (request: KibanaRequest) => Promise<InferencePolicy | null>,
    private readonly runRegex: InferencePolicyApi['runRegexRules']
  ) {}

  async read(scopeId: string): Promise<InferencePolicy | null> {
    const signal = this.scopes.getAbortSignal(scopeId);
    signal.throwIfAborted();
    const policy = await this.readPolicy(this.scopes.get<KibanaRequest>(scopeId));
    signal.throwIfAborted();
    if (policy) {
      if (!this.policies.has(scopeId)) {
        signal.addEventListener('abort', () => this.policies.delete(scopeId), { once: true });
      }
      this.policies.set(scopeId, structuredClone(policy));
    } else {
      this.policies.delete(scopeId);
    }
    return policy;
  }

  async runRegexRules(
    scopeId: string,
    payload: Parameters<InferencePolicyApi['runRegexRules']>[1]
  ): ReturnType<InferencePolicyApi['runRegexRules']> {
    const signal = this.scopes.getAbortSignal(scopeId);
    signal.throwIfAborted();
    this.scopes.get<KibanaRequest>(scopeId);
    const policy = this.policies.get(scopeId);
    if (
      !policy ||
      payload.rules.some(
        (rule) =>
          !policy.rules.some(
            (allowed) =>
              allowed.type === 'RegExp' && JSON.stringify(allowed) === JSON.stringify(rule)
          )
      )
    )
      throw new Error('Regex rules do not belong to the inference lease');
    const start = performance.now();
    const cpu = process.cpuUsage();
    try {
      const result = await this.runRegex(scopeId, payload);
      signal.throwIfAborted();
      return result;
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('inference_regex_helper', {
        scopeId,
        payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
        durationMs: performance.now() - start,
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }
}

/** Lists selection metadata only; execution config and secrets remain subject to Actions preparation. */
export const getWorkerConnectorDescriptors = (
  connectors: Awaited<ReturnType<ActionsClient['getAll']>>
): Awaited<ReturnType<ActionsClient['getAll']>> =>
  connectors.filter(isSupportedConnector).map((connector) => ({
    id: connector.id,
    name: connector.name,
    actionTypeId: connector.actionTypeId,
    isPreconfigured: connector.isPreconfigured,
    isDeprecated: connector.isDeprecated,
    isConnectorTypeDeprecated: connector.isConnectorTypeDeprecated,
    isMissingSecrets: connector.isMissingSecrets,
    referencedByCount: connector.referencedByCount,
    isSystemAction: connector.isSystemAction,
    config: {
      ...Object.fromEntries(
        [
          'apiProvider',
          'defaultModel',
          'contextWindowLength',
          'temperature',
          'enableNativeFunctionCalling',
          'inferenceId',
          'taskType',
        ].flatMap((key) => {
          const value = connector.config?.[key];
          return ['string', 'number', 'boolean'].includes(typeof value) ? [[key, value]] : [];
        })
      ),
      ...(connector.config?.providerConfig &&
      typeof connector.config.providerConfig === 'object' &&
      'model_id' in connector.config.providerConfig &&
      typeof connector.config.providerConfig.model_id === 'string'
        ? { providerConfig: { model_id: connector.config.providerConfig.model_id } }
        : {}),
    },
  }));

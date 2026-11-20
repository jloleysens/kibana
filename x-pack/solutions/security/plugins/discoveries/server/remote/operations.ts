/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'node:crypto';
import type { CoreStart, KibanaRequest, Logger } from '@kbn/core/server';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { remotable, recordRemoteTiming } from '@kbn/core-remote-common';
import { isWorkflowsEnabled } from '@kbn/discoveries/impl/lib/helpers/is_workflows_enabled';
import type { DiscoveriesPluginStartDeps } from '../types';
import { authenticateAndGetSpace } from '../workflows/steps/default_validation_step/helpers/authenticate_and_get_space';
import { resolveConnectorDetails } from '../workflows/helpers/resolve_connector_details';
import { asNonEmpty } from '../lib/non_empty_string';
import type { AttackDiscoveryOperationsApi } from './tokens';

export interface AttackDiscoveryOperationsDependencies {
  getStartServices(): Promise<{ coreStart: CoreStart; pluginsStart: DiscoveriesPluginStartDeps }>;
  logger: Logger;
}
/** Authorizes original request-scoped connector policy without moving the validation algorithm. */
@remotable()
export class AttackDiscoveryOperations implements AttackDiscoveryOperationsApi {
  readonly #retrievals = new Map<
    string,
    {
      scopeId: string;
      resolveConnector(connectorId: string): Promise<{ connectorName: string }>;
      release(): void;
    }
  >();
  async getRetrievalSpace(scopeId: string): Promise<string> {
    return this.#call(
      scopeId,
      'getRetrievalSpace',
      {},
      async () => this.scopes.getRunState(scopeId).spaceId
    );
  }
  async openRetrieval(scopeId: string): Promise<string> {
    return this.#call(scopeId, 'openRetrieval', {}, async () => {
      const { coreStart, pluginsStart } = await this.dependencies.getStartServices();
      if (!(await isWorkflowsEnabled(coreStart.featureFlags)))
        throw new Error('Attack Discovery workflows are not enabled');
      const request = this.scopes.get<KibanaRequest>(scopeId);
      const actionsClient = await pluginsStart.actions.getActionsClientWithRequest(request);
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      const reference = randomUUID();
      const release = () => {
        this.#retrievals.delete(reference);
        signal.removeEventListener('abort', release);
      };
      this.#retrievals.set(reference, {
        scopeId,
        release,
        resolveConnector: (connectorId) =>
          resolveConnectorDetails({
            actionsClient,
            connectorId,
            inference: pluginsStart.inference,
            logger: this.dependencies.logger,
            request,
          }),
      });
      signal.addEventListener('abort', release, { once: true });
      return reference;
    });
  }
  async resolveRetrievalConnector(
    scopeId: string,
    reference: string,
    connectorId: string
  ): Promise<{ connectorName: string }> {
    return this.#call(
      scopeId,
      'resolveRetrievalConnector',
      { reference, connectorId },
      async () => {
        const state = this.#retrievals.get(reference);
        if (!state || state.scopeId !== scopeId) throw new Error('Unknown retrieval reference');
        const { connectorName } = await state.resolveConnector(connectorId);
        return { connectorName };
      }
    );
  }
  async closeRetrieval(scopeId: string, reference: string): Promise<void> {
    return this.#call(scopeId, 'closeRetrieval', { reference }, async () => {
      const state = this.#retrievals.get(reference);
      if (!state) return;
      if (state.scopeId !== scopeId) throw new Error('Unknown retrieval reference');
      state.release();
    });
  }

  constructor(
    private readonly scopes: ScopeLookup,
    private readonly dependencies: AttackDiscoveryOperationsDependencies
  ) {}
  async checkEnabled(scopeId: string): ReturnType<AttackDiscoveryOperationsApi['checkEnabled']> {
    return this.#call(scopeId, 'checkEnabled', {}, async () => {
      const { coreStart } = await this.dependencies.getStartServices();
      if (!(await isWorkflowsEnabled(coreStart.featureFlags)))
        throw new Error('Attack Discovery workflows are not enabled');
      const { logger } = this.dependencies;
      return {
        all: logger.isLevelEnabled('all'),
        trace: logger.isLevelEnabled('trace'),
        debug: logger.isLevelEnabled('debug'),
        info: logger.isLevelEnabled('info'),
        warn: logger.isLevelEnabled('warn'),
        error: logger.isLevelEnabled('error'),
        fatal: logger.isLevelEnabled('fatal'),
        off: logger.isLevelEnabled('off'),
      };
    });
  }
  async prepareValidation(
    scopeId: string,
    input: Parameters<AttackDiscoveryOperationsApi['prepareValidation']>[1]
  ): ReturnType<AttackDiscoveryOperationsApi['prepareValidation']> {
    return this.#call(scopeId, 'prepareValidation', input, async () => {
      const { coreStart, pluginsStart } = await this.dependencies.getStartServices();
      if (!(await isWorkflowsEnabled(coreStart.featureFlags)))
        throw new Error('Attack Discovery workflows are not enabled');
      const request = this.scopes.get<KibanaRequest>(scopeId);
      const { spaceId } = await authenticateAndGetSpace({ coreStart, pluginsStart, request });
      const connectorId = input.api_config.connector_id;
      if (!connectorId) throw new Error('Missing connector_id in api_config');
      const actionsClient = await pluginsStart.actions.getActionsClientWithRequest(request);
      const { connectorName: resolvedConnectorName } = await resolveConnectorDetails({
        actionsClient,
        connectorId,
        connectorName: asNonEmpty(input.connector_name),
        inference: pluginsStart.inference,
        logger: this.dependencies.logger,
        request,
      });
      return { spaceId, resolvedConnectorName };
    });
  }
  async validationDiagnostics(
    scopeId: string,
    records: Parameters<AttackDiscoveryOperationsApi['validationDiagnostics']>[1]
  ): Promise<void> {
    return this.#call(scopeId, 'validationDiagnostics', records, async () => {
      for (const { level, message, context, meta } of records) {
        const logger = this.dependencies.logger.get(...context);
        if (level === 'all' || level === 'off') continue;
        if (meta === undefined) logger[level](message);
        else logger[level](message, meta);
      }
    });
  }
  async #call<T>(
    scopeId: string,
    operation: string,
    input: object,
    call: () => Promise<T>
  ): Promise<T> {
    const started = performance.now();
    const cpu = process.cpuUsage();
    try {
      this.scopes.getRunState(scopeId);
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      const result = await call();
      signal.throwIfAborted();
      return result;
    } catch (error) {
      // Only public builtin name/message may cross this service boundary.
      const source = error instanceof Error ? error : new Error(String(error));
      const safe =
        source instanceof TypeError
          ? new TypeError(source.message)
          : source instanceof RangeError
          ? new RangeError(source.message)
          : new Error(source.message);
      Object.assign(safe, { attackDiscoveryErrorName: source.name });
      throw safe;
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('attack_discovery_operations_' + operation, {
        scopeId,
        payloadBytes: Buffer.byteLength(JSON.stringify(input)),
        durationMs: performance.now() - started,
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }
}

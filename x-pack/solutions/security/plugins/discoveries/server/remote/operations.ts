/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'node:crypto';
import type { CoreStart, KibanaRequest, Logger } from '@kbn/core/server';
import { withRemoteLeaseParent, type ScopeLookup } from '@kbn/core-remote-server';
import { remotable, recordRemoteTiming } from '@kbn/core-remote-common';
import { isWorkflowsEnabled } from '@kbn/discoveries/impl/lib/helpers/is_workflows_enabled';
import type { DiscoveriesPluginStartDeps } from '../types';
import { authenticateAndGetSpace } from '../workflows/steps/default_validation_step/helpers/authenticate_and_get_space';
import { resolveConnectorDetails } from '../workflows/helpers/resolve_connector_details';
import { asNonEmpty } from '../lib/non_empty_string';
import {
  prepareRun,
  type PreparedRun,
  type RunDependencies,
} from '../workflows/steps/run_step/prepare_run';
import type { AttackDiscoveryOperationsApi } from './tokens';
import {
  prepareGeneration,
  type GenerationDependencies,
} from '../workflows/steps/generate_step/prepare_generation';
import {
  persistDiscoveries,
  type PersistDiscoveriesDependencies,
} from '../workflows/steps/persist_discoveries_step/persist_discoveries';
import type { PreparedGeneration } from '../workflows/steps/generate_step/generate_handler';

export interface AttackDiscoveryOperationsDependencies
  extends GenerationDependencies,
    RunDependencies {
  adhocAttackDiscoveryDataClient?: PersistDiscoveriesDependencies['adhocAttackDiscoveryDataClient'];
  getStartServices(): Promise<{ coreStart: CoreStart; pluginsStart: DiscoveriesPluginStartDeps }>;
  logger: Logger;
}
/** Authorizes original request-scoped connector policy without moving the validation algorithm. */
@remotable()
export class AttackDiscoveryOperations implements AttackDiscoveryOperationsApi {
  readonly #runs = new Map<
    string,
    {
      scopeId: string;
      prepared: PreparedRun;
      controller: AbortController;
      started: boolean;
      release(): void;
    }
  >();
  async openRun(
    scopeId: string,
    stepId: string,
    input: { connectorId?: string; featureId?: string | string[] }
  ): ReturnType<AttackDiscoveryOperationsApi['openRun']> {
    return this.#call(scopeId, 'openRun', input, async () => {
      if (this.scopes.resolveStepType(scopeId, stepId) !== 'security.attack-discovery.run')
        throw new Error('Not an attack discovery run step');
      const reference = randomUUID();
      const controller = new AbortController();
      const signal = this.scopes.getAbortSignal(scopeId);
      const release = () => {
        this.#runs.delete(reference);
        signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        controller.abort(signal.reason);
        release();
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        const prepared = await prepareRun(
          { connectorId: input.connectorId, featureId: input.featureId },
          this.scopes.get<KibanaRequest>(scopeId),
          controller.signal,
          this.dependencies
        );
        signal.throwIfAborted();
        this.#runs.set(reference, { scopeId, prepared, controller, started: false, release });
        return {
          reference,
          executionUuid: prepared.executionUuid,
          effectiveConnectorId: prepared.effectiveConnectorId,
        };
      } catch (error) {
        release();
        throw error;
      }
    });
  }
  async startRun(
    scopeId: string,
    reference: string,
    input: Parameters<AttackDiscoveryOperationsApi['startRun']>[2],
    mode: 'sync' | 'async'
  ): ReturnType<AttackDiscoveryOperationsApi['startRun']> {
    return this.#call(scopeId, 'startRun', input, async () => {
      const state = this.#runs.get(reference);
      if (!state || state.scopeId !== scopeId) throw new Error('Unknown run reference');
      if (state.started) throw new Error('Run reference already consumed');
      state.started = true;
      const params = {
        alerts: input.alerts,
        end: input.end,
        filter: input.filter,
        size: input.size,
        start: input.start,
        workflowConfig: input.workflowConfig,
      };
      if (mode === 'async') {
        await withRemoteLeaseParent(this.scopes, scopeId, () =>
          state.prepared.launch(params, state.release)
        );
        return;
      }
      try {
        return await withRemoteLeaseParent(this.scopes, scopeId, () =>
          state.prepared.execute(params)
        );
      } finally {
        state.release();
      }
    });
  }
  async finishRun(scopeId: string, reference: string): Promise<void> {
    return this.#call(scopeId, 'finishRun', { reference }, async () => {
      const state = this.#runs.get(reference);
      if (!state) return;
      if (state.scopeId !== scopeId) throw new Error('Unknown run reference');
      // The completed async step loses cancellation ownership, exactly as the original engine.
      state.release();
    });
  }
  async cancelRun(scopeId: string, reference: string): Promise<void> {
    return this.#call(scopeId, 'cancelRun', { reference }, async () => {
      const state = this.#runs.get(reference);
      if (!state) return;
      if (state.scopeId !== scopeId) throw new Error('Unknown run reference');
      state.controller.abort();
      state.release();
    });
  }
  async persist(
    scopeId: string,
    input: Parameters<AttackDiscoveryOperationsApi['persist']>[1]
  ): ReturnType<AttackDiscoveryOperationsApi['persist']> {
    return this.#call(scopeId, 'persist', input, async () => {
      const { coreStart } = await this.dependencies.getStartServices();
      if (!(await isWorkflowsEnabled(coreStart.featureFlags)))
        throw new Error('Attack Discovery workflows are not enabled');
      const { adhocAttackDiscoveryDataClient } = this.dependencies;
      if (!adhocAttackDiscoveryDataClient)
        throw new Error('Attack discovery rule data client is unavailable');
      return persistDiscoveries(
        {
          alerts_context_count: input.alerts_context_count,
          anonymized_alerts: input.anonymized_alerts,
          api_config: input.api_config,
          attack_discoveries: input.attack_discoveries,
          connector_name: input.connector_name,
          enable_field_rendering: input.enable_field_rendering,
          generation_source: input.generation_source,
          generation_uuid: input.generation_uuid,
          replacements: input.replacements,
          source: input.source,
          with_replacements: input.with_replacements,
        },
        this.scopes.get<KibanaRequest>(scopeId),
        { ...this.dependencies, adhocAttackDiscoveryDataClient }
      );
    });
  }
  readonly #generations = new Map<
    string,
    {
      scopeId: string;
      prepared: PreparedGeneration;
      started: boolean;
      controller: AbortController;
      release(): void;
    }
  >();
  async openGeneration(
    scopeId: string,
    stepId: string,
    apiConfig: Parameters<AttackDiscoveryOperationsApi['openGeneration']>[2]
  ): ReturnType<AttackDiscoveryOperationsApi['openGeneration']> {
    return this.#call(scopeId, 'openGeneration', { stepId, apiConfig }, async () => {
      if (this.scopes.resolveStepType(scopeId, stepId) !== 'security.attack-discovery.generate')
        throw new Error('Not an attack discovery generation step');
      const { coreStart } = await this.dependencies.getStartServices();
      if (!(await isWorkflowsEnabled(coreStart.featureFlags)))
        throw new Error('Attack Discovery workflows are not enabled');
      const signal = this.scopes.getAbortSignal(scopeId);
      const controller = new AbortController();
      const reference = randomUUID();
      const release = () => {
        this.#generations.delete(reference);
        signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        controller.abort(signal.reason);
        release();
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        const prepared = await prepareGeneration(
          {
            apiConfig: {
              action_type_id: apiConfig.action_type_id,
              connector_id: apiConfig.connector_id,
              model: apiConfig.model,
            },
            request: this.scopes.get<KibanaRequest>(scopeId),
            executionUuid: this.scopes.getRunState(scopeId).workflowRunId,
            abortSignal: controller.signal,
          },
          this.dependencies
        );
        signal.throwIfAborted();
        this.#generations.set(reference, {
          scopeId,
          prepared,
          started: false,
          controller,
          release,
        });
        return { reference, executionUuid: prepared.executionUuid };
      } catch (error) {
        release();
        throw error;
      }
    });
  }
  async generate(
    scopeId: string,
    reference: string,
    input: Parameters<AttackDiscoveryOperationsApi['generate']>[2]
  ): ReturnType<AttackDiscoveryOperationsApi['generate']> {
    return this.#call(scopeId, 'generate', input, async () => {
      const state = this.#generations.get(reference);
      if (!state || state.scopeId !== scopeId) throw new Error('Unknown generation reference');
      if (state.started) throw new Error('Generation reference already consumed');
      state.started = true;
      try {
        return await state.prepared.invoke({
          additionalContext: input.additionalContext,
          replacements: input.replacements,
          size: input.size,
          sourceAlerts: input.sourceAlerts,
        });
      } finally {
        state.release();
      }
    });
  }
  async closeGeneration(scopeId: string, reference: string): Promise<void> {
    return this.#call(scopeId, 'closeGeneration', { reference }, async () => {
      const state = this.#generations.get(reference);
      if (!state) return;
      if (state.scopeId !== scopeId) throw new Error('Unknown generation reference');
      state.controller.abort();
      state.release();
    });
  }
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

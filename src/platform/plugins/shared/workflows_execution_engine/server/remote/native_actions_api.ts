/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { clearTimeout, setTimeout } from 'node:timers';
import { PreparedExecution } from '@kbn/actions-plugin/server';
import type {
  ActionsClient,
  ConnectorFinalization,
  ConnectorPreparation,
  NativeActionsApi,
} from '@kbn/actions-plugin/server';
import type { KibanaRequest, Logger } from '@kbn/core/server';
import { recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import type { ScopeLookup } from '@kbn/core-remote-server';
import type { IEvent } from '@kbn/event-log-plugin/server';
import { withNativeActionsErrorBoundary } from './native_actions_error';
import { ConnectorExecutor } from '../connector_executor';

interface FinalizationBatch {
  readonly events: Promise<IEvent[]>;
  persistence?: Promise<void>;
}

/** Prepares referenced connectors with live Actions policy and drains original event finalizers. */
@remotable()
export class NativeActions implements NativeActionsApi {
  private readonly scopesState = new Map<
    string,
    {
      readonly client: Promise<ActionsClient>;
      readonly actionInfo: NonNullable<ConstructorParameters<typeof PreparedExecution>[5]>;
      readonly pending: Map<string, PreparedExecution>;
      readonly invocations: Set<string>;
      readonly batches: Map<string, FinalizationBatch>;
      inferenceFacts?: Promise<
        import('@kbn/actions-plugin/server/remote/types').InferenceStreamingFacts
      >;
      readonly resolver: Promise<ConnectorExecutor>;
    }
  >();
  private readonly refreshLeases = new Map<
    string,
    {
      readonly scopeId: string;
      readonly invocationId: string;
      readonly execution: PreparedExecution;
      readonly timeout: NodeJS.Timeout;
    }
  >();
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly getClient: (request: KibanaRequest) => Promise<ActionsClient>,
    private readonly getInferenceFacts?: (
      request: KibanaRequest
    ) => Promise<import('@kbn/actions-plugin/server/remote/types').InferenceStreamingFacts>,
    private readonly logger?: Pick<Logger, 'error'>
  ) {}

  async prepare(
    scopeId: string,
    invocationId: string,
    request: Parameters<NativeActionsApi['prepare']>[2]
  ): Promise<ConnectorPreparation> {
    return withNativeActionsErrorBoundary(async () => {
      const start = performance.now();
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      let state = this.scopesState.get(scopeId);
      if (!state) {
        const client = this.getClient(this.scopes.get<KibanaRequest>(scopeId));
        state = {
          client,
          actionInfo: new Map(),
          pending: new Map(),
          invocations: new Set(),
          batches: new Map(),
          resolver: client.then((actionsClient) => new ConnectorExecutor(actionsClient)),
        };
        this.scopesState.set(scopeId, state);
        const activeState = state;
        signal.addEventListener(
          'abort',
          () => {
            activeState.actionInfo.clear();
            activeState.pending.clear();
            activeState.invocations.clear();
            activeState.batches.clear();
            this.scopesState.delete(scopeId);
          },
          { once: true }
        );
      }
      if (state.invocations.has(invocationId))
        throw new Error('Duplicate native connector invocation');
      state.invocations.add(invocationId);
      const actionId = await (await state.resolver).resolveConnectorId(request.connectorNameOrId);
      signal.throwIfAborted();
      const preparedState = state;
      const getInferenceFacts = this.getInferenceFacts;
      const execution = new PreparedExecution(
        await state.client,
        actionId,
        request.connectorType,
        request.input,
        signal,
        state.actionInfo,
        request.connectorType.replace(/^\./, '') === 'inference' && getInferenceFacts
          ? () => {
              if (!preparedState.inferenceFacts)
                preparedState.inferenceFacts = getInferenceFacts(
                  this.scopes.get<KibanaRequest>(scopeId)
                );
              return preparedState.inferenceFacts;
            }
          : undefined
      );
      state.pending.set(invocationId, execution);
      try {
        const result = await execution.preparation;
        if ('result' in result) {
          // Preflight refusal has no worker execution to finalize.
          const batch = { events: execution.refusalEvents() };
          state.batches.set(JSON.stringify([invocationId]), batch);
          await this.#persistBatch(batch, state.client).catch(() =>
            this.finalizeRetry(scopeId, [invocationId])
          );
          state.pending.delete(invocationId);
        }
        return result;
      } catch (error) {
        state.pending.delete(invocationId);
        throw error;
      } finally {
        recordRemoteTiming('connector_prepare', {
          scopeId,
          stepType: request.connectorType,
          durationMs: performance.now() - start,
        });
      }
    }, this.logger);
  }

  async dashboard(
    scopeId: string,
    invocationId: string,
    request: Parameters<NativeActionsApi['dashboard']>[2]
  ): ReturnType<NativeActionsApi['dashboard']> {
    return withNativeActionsErrorBoundary(async () => {
      this.scopes.getAbortSignal(scopeId).throwIfAborted();
      const execution = this.scopesState.get(scopeId)?.pending.get(invocationId);
      if (!execution) throw new Error('Unknown native connector invocation');
      return execution.dashboard(request);
    }, this.logger);
  }

  async relay(
    scopeId: string,
    invocationId: string,
    request: Parameters<NativeActionsApi['relay']>[2]
  ): ReturnType<NativeActionsApi['relay']> {
    return withNativeActionsErrorBoundary(async () => {
      this.scopes.getAbortSignal(scopeId).throwIfAborted();
      this.scopes.get<KibanaRequest>(scopeId);
      const execution = this.scopesState.get(scopeId)?.pending.get(invocationId);
      if (!execution) throw new Error('Unknown native connector invocation');
      return execution.relay(request);
    }, this.logger);
  }

  async token(
    scopeId: string,
    invocationId: string,
    request: Parameters<NativeActionsApi['token']>[2]
  ): ReturnType<NativeActionsApi['token']> {
    return withNativeActionsErrorBoundary(async () => {
      if (
        (request.operation === 'refresh' || request.operation === 'endRefresh') &&
        request.refreshLease
      ) {
        const lease = this.refreshLeases.get(request.refreshLease);
        if (!lease || lease.scopeId !== scopeId || lease.invocationId !== invocationId)
          throw new Error('Unknown OAuth refresh transaction lease');
        try {
          return await lease.execution.token(request);
        } finally {
          if (request.operation === 'endRefresh') {
            clearTimeout(lease.timeout);
            this.refreshLeases.delete(request.refreshLease);
          }
        }
      }
      this.scopes.getAbortSignal(scopeId).throwIfAborted();
      this.scopes.get<KibanaRequest>(scopeId);
      const execution = this.scopesState.get(scopeId)?.pending.get(invocationId);
      if (!execution) throw new Error('Unknown native connector invocation');
      const response = await execution.token(request);
      if (request.operation === 'beginRefresh' && response.refreshLease) {
        const id = response.refreshLease;
        const timeout = setTimeout(() => this.refreshLeases.delete(id), 125_000);
        timeout.unref();
        this.refreshLeases.set(id, { scopeId, invocationId, execution, timeout });
      }
      return response;
    }, this.logger);
  }

  async finalize(scopeId: string, results: ConnectorFinalization[]): Promise<void> {
    return withNativeActionsErrorBoundary(async () => {
      const started = performance.now();
      this.scopes.get<KibanaRequest>(scopeId);
      const state = this.scopesState.get(scopeId);
      if (!state) throw new Error('Native connector scope is not prepared');
      const unique = new Set(results.map(({ invocationId }) => invocationId));
      if (unique.size !== results.length) throw new Error('Duplicate connector finalization');
      const batchId = JSON.stringify([...unique].sort());
      let batch = state.batches.get(batchId);
      if (!batch) {
        const executions = results.map(({ invocationId }) => {
          const execution = state.pending.get(invocationId);
          if (!execution) throw new Error('Unknown native connector invocation');
          return execution;
        });
        for (const id of unique) state.pending.delete(id);
        batch = {
          events: Promise.all(
            executions.map((execution, index) => execution.finalize(results[index].runtime))
          ).then((events) => events.flat()),
        };
        state.batches.set(batchId, batch);
      }
      await this.#persistBatch(batch, state.client);
      recordRemoteTiming('connector_finalize', {
        scopeId,
        durationMs: performance.now() - started,
      });
    }, this.logger);
  }
  async finalizeRetry(scopeId: string, invocationIds: string[]): Promise<void> {
    return withNativeActionsErrorBoundary(async () => {
      this.scopes.get<KibanaRequest>(scopeId);
      const state = this.scopesState.get(scopeId);
      if (!state) throw new Error('Native connector scope is not prepared');
      if (new Set(invocationIds).size !== invocationIds.length)
        throw new Error('Duplicate connector finalization');
      const batch = state.batches.get(JSON.stringify([...invocationIds].sort()));
      if (!batch) throw new Error('Unknown native connector finalization batch');
      await this.#persistBatch(batch, state.client, scopeId);
    }, this.logger);
  }

  async #persistBatch(
    batch: FinalizationBatch,
    client: Promise<ActionsClient>,
    lossScopeId?: string
  ): Promise<void> {
    if (!batch.persistence) {
      batch.persistence = (async () => {
        const events = await batch.events;
        try {
          await (await client).finalizeExecutionEvents(events);
        } catch (error) {
          if (!lossScopeId) throw error;
          // Ordinary Actions logs event-index failures without failing a successful connector.
          this.logger?.error(error);
          this.logger?.error(
            'Native connector event persistence failed after retry; event loss logged'
          );
          recordRemoteTiming('connector_finalization_loss', { scopeId: lossScopeId });
        }
      })().catch((error) => {
        batch.persistence = undefined;
        throw error;
      });
    }
    await batch.persistence;
  }
}

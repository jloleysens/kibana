/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { PreparedExecution } from '@kbn/actions-plugin/server';
import type {
  ActionsClient,
  ConnectorFinalization,
  ConnectorPreparation,
  NativeActionsApi,
} from '@kbn/actions-plugin/server';
import type { KibanaRequest } from '@kbn/core/server';
import { recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { ConnectorExecutor } from '../connector_executor';

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
      readonly resolver: Promise<ConnectorExecutor>;
    }
  >();
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly getClient: (request: KibanaRequest) => Promise<ActionsClient>
  ) {}

  async prepare(
    scopeId: string,
    invocationId: string,
    request: Parameters<NativeActionsApi['prepare']>[2]
  ): Promise<ConnectorPreparation> {
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
    const execution = new PreparedExecution(
      await state.client,
      actionId,
      request.connectorType,
      request.input,
      signal,
      state.actionInfo
    );
    state.pending.set(invocationId, execution);
    try {
      const result = await execution.preparation;
      if ('result' in result) {
        // Preflight refusal has no worker execution to finalize.
        await (await state.client).finalizeExecutionEvents(await execution.refusalEvents());
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
  }

  async token(
    scopeId: string,
    invocationId: string,
    request: Parameters<NativeActionsApi['token']>[2]
  ): ReturnType<NativeActionsApi['token']> {
    this.scopes.getAbortSignal(scopeId).throwIfAborted();
    this.scopes.get<KibanaRequest>(scopeId);
    const execution = this.scopesState.get(scopeId)?.pending.get(invocationId);
    if (!execution) throw new Error('Unknown native connector invocation');
    return execution.token(request);
  }

  async finalize(scopeId: string, results: ConnectorFinalization[]): Promise<void> {
    const started = performance.now();
    this.scopes.get<KibanaRequest>(scopeId);
    const state = this.scopesState.get(scopeId);
    if (!state) throw new Error('Native connector scope is not prepared');
    const unique = new Set(results.map(({ invocationId }) => invocationId));
    if (unique.size !== results.length) throw new Error('Duplicate connector finalization');
    const executions = results.map(({ invocationId }) => {
      const execution = state.pending.get(invocationId);
      if (!execution) throw new Error('Unknown native connector invocation');
      return execution;
    });
    const events = await Promise.all(
      executions.map((execution, index) => execution.finalize(results[index].runtime))
    );
    await (await state.client).finalizeExecutionEvents(events.flat());
    for (const id of unique) state.pending.delete(id);
    recordRemoteTiming('connector_finalize', { scopeId, durationMs: performance.now() - started });
  }
}

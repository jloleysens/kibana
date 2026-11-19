/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { kibanaPackageJson } from '@kbn/repo-info';
import type { IEvent } from '@kbn/event-log-plugin/server';
import type { ActionsClient } from '../actions_client';
import type { ActionRuntimeResult } from '../lib/execute_action';
import { ActionExecutionError } from '../lib/errors/action_execution_error';
import type { ExecuteOptions } from '../lib/action_executor';
import type { ConnectorPreparation, ConnectorTokenRequest, ConnectorTokenResponse } from './types';
import { ConnectorTokenState } from './connector_token_state';

/** Keeps live authorization and final event production on the coordinator without executing a handler. */
export class PreparedExecution {
  readonly preparation: Promise<ConnectorPreparation>;
  private readonly completion: Promise<unknown>;
  private readonly events: IEvent[] = [];
  private resolveRuntime?: (result: ActionRuntimeResult) => void;
  private rejectRuntime?: (error: Error) => void;
  private completed = false;
  private tokenState?: ConnectorTokenState;
  private readonly onAbort: () => void;

  constructor(
    client: Pick<ActionsClient, 'executeWithRuntime'>,
    actionId: string,
    connectorType: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    actionInfo?: NonNullable<ExecuteOptions['runtime']>['actionInfo']
  ) {
    let ready: (result: ConnectorPreparation) => void = () => {};
    const preparation = new Promise<ConnectorPreparation>((resolve) => {
      ready = resolve;
    });
    const runtime = new Promise<ActionRuntimeResult>((resolve, reject) => {
      this.resolveRuntime = resolve;
      this.rejectRuntime = reject;
    });
    // A preparation failure may occur before the runtime is entered.
    void runtime.catch(() => {});
    this.onAbort = () => {
      this.tokenState?.close();
      this.rejectRuntime?.(new Error('Connector scope closed'));
    };
    signal.addEventListener('abort', this.onAbort, { once: true });
    if (signal.aborted) this.onAbort();
    const execution = client.executeWithRuntime(
      { actionId, params: input, signal },
      {
        events: this.events,
        actionInfo,
        execute: async (options) => {
          if (options.actionType.id.replace(/^\./, '') !== connectorType.replace(/^\./, ''))
            throw new Error('Connector type mismatch');
          try {
            await options.authorize?.();
          } catch (error) {
            if (!(error instanceof ActionExecutionError)) throw error;
            return {
              validatedParams: options.params,
              result: error.result,
              errorType: 'unauthorized',
              executionStartedAt: Date.now(),
              executionCompletedAt: Date.now(),
              handlerStarted: false,
            };
          }
          signal.throwIfAborted();
          if (!options.runtimeConfig) throw new Error('Missing connector network policy');
          if (options.connectorTokenClient) {
            this.tokenState = new ConnectorTokenState(
              options.connectorTokenClient,
              options,
              signal
            );
          }
          ready({
            prepared: {
              kibanaVersion: kibanaPackageJson.version,
              actionId: options.actionId,
              actionTypeId: options.actionType.id,
              name: options.name,
              params: options.params,
              config: options.config,
              secrets: options.secrets,
              runtimeConfig: options.runtimeConfig,
              userAgent: options.runtimeUserAgent,
              authMode: options.authMode,
              profileUid: options.profileUid,
              connectorVersion: options.connectorVersion,
            },
          });
          return runtime;
        },
      }
    );
    this.preparation = Promise.race([
      preparation,
      execution.then((result): ConnectorPreparation => ({ result })),
    ]);
    this.completion = execution.finally(() => signal.removeEventListener('abort', this.onAbort));
    void this.completion.catch(() => {});
  }

  async token(request: ConnectorTokenRequest): Promise<ConnectorTokenResponse> {
    if (this.completed || !this.tokenState)
      throw new Error('Connector token state is not available');
    return this.tokenState.execute(request);
  }

  async refusalEvents(): Promise<IEvent[]> {
    await this.completion;
    return this.events;
  }

  async finalize(result: ActionRuntimeResult): Promise<IEvent[]> {
    if (this.completed) throw new Error('Connector invocation already finalized');
    this.completed = true;
    this.tokenState?.close();
    this.resolveRuntime?.(result);
    await this.completion;
    return this.events;
  }
}

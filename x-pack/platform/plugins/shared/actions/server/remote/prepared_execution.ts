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
import type { ConnectorRelayRequest, ConnectorRelayResponse } from './types';
import { ConnectorRelayTransport } from './connector_relay_transport';
import { ConnectorDashboardState } from './connector_dashboard_state';
import type {
  ConnectorDashboardRequest,
  ConnectorDashboardResponse,
  InferenceStreamingFacts,
} from './types';
import { requestEarsRefreshToken } from '../lib/ears/request_ears_refresh_token';
import { ConnectorTokenState } from './connector_token_state';

/** Keeps live authorization and final event production on the coordinator without executing a handler. */
export class PreparedExecution {
  readonly preparation: Promise<ConnectorPreparation>;
  private readonly completion: Promise<unknown>;
  private readonly events: IEvent[] = [];
  private resolveRuntime?: (result: ActionRuntimeResult) => void;
  private rejectRuntime?: (error: Error) => void;
  private completed = false;
  private dashboardState?: ConnectorDashboardState;
  private tokenState?: ConnectorTokenState;
  private relayTransport?: ConnectorRelayTransport;
  private readonly onAbort: () => void;

  constructor(
    client: Pick<ActionsClient, 'executeWithRuntime'>,
    actionId: string,
    connectorType: string | undefined,
    input: Record<string, unknown>,
    signal: AbortSignal,
    actionInfo?: NonNullable<ExecuteOptions['runtime']>['actionInfo'],
    getInferenceFacts?: () => Promise<InferenceStreamingFacts>
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
      this.dashboardState?.close();
      this.tokenState?.close();
      this.relayTransport?.close();
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
          if (
            connectorType !== undefined &&
            options.actionType.id.replace(/^\./, '') !== connectorType.replace(/^\./, '')
          )
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
          const earsSsl =
            options.secrets.authType === 'ears'
              ? options.configurationUtilities.getEARSSSLSettings()
              : undefined;
          const hasEarsDeploymentIdentity = Boolean(
            options.runtimeConfig.auth.ears?.ssl?.certificate ||
              options.runtimeConfig.auth.ears?.ssl?.key ||
              earsSsl?.cert ||
              earsSsl?.key
          );
          const earsTransportAvailable =
            options.secrets.authType === 'ears' && hasEarsDeploymentIdentity;
          const earsProvider =
            typeof options.secrets.provider === 'string' ? options.secrets.provider : undefined;
          if (earsTransportAvailable && !earsProvider)
            throw new Error('Prepared EARS provider is missing');
          const refreshEars =
            earsTransportAvailable && earsProvider
              ? (refreshToken: string) =>
                  requestEarsRefreshToken(
                    earsProvider,
                    options.logger,
                    { refreshToken },
                    options.configurationUtilities
                  )
              : undefined;
          if (options.connectorTokenClient) {
            this.tokenState = new ConnectorTokenState(
              options.connectorTokenClient,
              options,
              signal,
              refreshEars,
              options.logger
            );
          }
          if (options.relayClient) {
            this.relayTransport = new ConnectorRelayTransport(
              options.relayClient,
              options,
              signal,
              options.logger
            );
          }
          this.dashboardState = new ConnectorDashboardState(
            options.services.savedObjectsClient,
            options.actionType.id,
            options.params,
            signal,
            options.actionType.getDashboardAttributes,
            options.logger
          );
          const inferenceStreamingFacts =
            getInferenceFacts && options.actionType.id.replace(/^\./, '') === 'inference'
              ? await getInferenceFacts()
              : undefined;
          signal.throwIfAborted();
          ready({
            prepared: {
              inferenceStreamingFacts,
              emailExecutionFacts: await options.actionType.getEmailExecutionFacts?.(
                options.config
              ),
              kibanaVersion: kibanaPackageJson.version,
              actionId: options.actionId,
              actionTypeId: options.actionType.id,
              name: options.name,
              params: options.params,
              config: options.config,
              secrets: options.secrets,
              runtimeConfig: {
                ...options.runtimeConfig,
                auth: {
                  ...options.runtimeConfig.auth,
                  ears: options.runtimeConfig.auth.ears
                    ? {
                        ...options.runtimeConfig.auth.ears,
                        // EARS deployment mTLS authenticates AS KIBANA and stays on the coordinator.
                        ...(hasEarsDeploymentIdentity ? { ssl: undefined } : {}),
                      }
                    : undefined,
                },
              },
              earsTransportAvailable,
              userAgent: options.runtimeUserAgent,
              relayAvailable: Boolean(options.relayClient),
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

  async dashboard(request: ConnectorDashboardRequest): Promise<ConnectorDashboardResponse> {
    if (this.completed || !this.dashboardState) throw new Error('Dashboard invocation is closed');
    return this.dashboardState.execute(request);
  }

  async relay(request: ConnectorRelayRequest): Promise<ConnectorRelayResponse> {
    if (this.completed || !this.relayTransport)
      throw new Error('Connector Relay transport is not available');
    return this.relayTransport.execute(request);
  }

  async token(request: ConnectorTokenRequest): Promise<ConnectorTokenResponse> {
    const persistence =
      (request.operation === 'refresh' || request.operation === 'endRefresh') &&
      request.refreshLease;
    if ((this.completed && !persistence) || !this.tokenState)
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
    this.dashboardState?.close();
    this.tokenState?.close();
    this.relayTransport?.close();
    this.resolveRuntime?.(result);
    await this.completion;
    return this.events;
  }
}

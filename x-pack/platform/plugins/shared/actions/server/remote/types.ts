/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RelayActionClient } from '@kbn/connector-specs';
import type { AuthMode } from '@kbn/connector-specs-runtime';
import type { RuntimeActionsConfig } from '../actions_config';
import type { ActionRuntimeResult } from '../lib/execute_action';
import type { ActionTypeExecutorResult, ConnectorTokenStore } from '../types';

export interface InferenceStreamingFacts {
  readonly enabled?: boolean;
  readonly services?: Array<
    Pick<import('@kbn/inference-common').InferenceProvider, 'service' | 'features'>
  >;
}

export type ConnectorDashboardRequest =
  | { readonly operation: 'get' }
  | { readonly operation: 'create' };
export type ConnectorDashboardResponse =
  | { readonly value: import('@kbn/core-saved-objects-server').SavedObject }
  | {
      readonly error: {
        readonly message: string;
        readonly statusCode: number;
        readonly error: string;
      };
    };

export interface PreparedConnector {
  readonly inferenceStreamingFacts?: InferenceStreamingFacts;
  readonly kibanaVersion: string;
  readonly actionId: string;
  readonly actionTypeId: string;
  readonly name: string;
  readonly config: Record<string, unknown>;
  readonly secrets: Record<string, unknown>;
  readonly params: Record<string, unknown>;
  readonly runtimeConfig: RuntimeActionsConfig;
  readonly userAgent?: string;
  readonly relayAvailable?: boolean;
  readonly earsTransportAvailable?: boolean;
  readonly authMode?: AuthMode;
  readonly profileUid?: string;
  readonly connectorVersion?: string;
}
export type ConnectorPreparation =
  | { readonly prepared: PreparedConnector }
  | { readonly result: ActionTypeExecutorResult<unknown> };
export interface ConnectorFinalization {
  readonly invocationId: string;
  readonly runtime: ActionRuntimeResult;
}
export interface NativeActionsApi {
  dashboard(
    scopeId: string,
    invocationId: string,
    request: ConnectorDashboardRequest
  ): Promise<ConnectorDashboardResponse>;
  prepare(
    scopeId: string,
    invocationId: string,
    request: {
      readonly connectorType: string;
      readonly connectorNameOrId: string;
      readonly input: Record<string, unknown>;
    }
  ): Promise<ConnectorPreparation>;
  relay(
    scopeId: string,
    invocationId: string,
    request: ConnectorRelayRequest
  ): Promise<ConnectorRelayResponse>;
  token(
    scopeId: string,
    invocationId: string,
    request: ConnectorTokenRequest
  ): Promise<ConnectorTokenResponse>;
  finalize(scopeId: string, results: ConnectorFinalization[]): Promise<void>;
}

export type ConnectorTokenRequest =
  | { readonly operation: 'acquireRefreshLock' | 'releaseRefreshLock' }
  | { readonly operation: 'refreshEars'; readonly refreshToken: string }
  | {
      readonly operation: 'get';
      readonly options: Pick<
        Parameters<ConnectorTokenStore['get']>[0],
        'tokenType' | 'credentialType'
      >;
    }
  | {
      readonly operation: 'replace';
      readonly options: Pick<
        Parameters<ConnectorTokenStore['updateOrReplace']>[0],
        'token' | 'newToken' | 'expiresInSec' | 'tokenRequestDate' | 'deleteExisting'
      >;
    }
  | { readonly operation: 'delete' }
  | {
      readonly operation: 'refresh';
      readonly options: Parameters<ConnectorTokenStore['updateWithRefreshToken']>[0];
    };
export interface ConnectorTokenResponse {
  readonly earsToken?: import('../lib/request_oauth_token').OAuthTokenResponse;
  readonly hasErrors: boolean;
  readonly connectorToken: Awaited<ReturnType<ConnectorTokenStore['get']>>['connectorToken'];
}

export type ConnectorRelayRequest =
  | {
      readonly operation: 'trigger';
      readonly input: Omit<Parameters<RelayActionClient['trigger']>[0], 'tenantKey'> & {
        readonly blocks?: Array<Record<string, unknown>>;
      };
    }
  | {
      readonly operation: 'listBindings';
      readonly options?: Parameters<RelayActionClient['listBindings']>[1];
    };
export type ConnectorRelayResponse =
  | {
      readonly operation: 'trigger';
      readonly result: Awaited<ReturnType<RelayActionClient['trigger']>>;
    }
  | {
      readonly operation: 'listBindings';
      readonly result: Awaited<ReturnType<RelayActionClient['listBindings']>>;
    }
  | { readonly error: { readonly statusCode?: number } };

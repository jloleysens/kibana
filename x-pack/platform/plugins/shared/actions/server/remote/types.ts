/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AuthMode } from '@kbn/connector-specs-runtime';
import type { RuntimeActionsConfig } from '../actions_config';
import type { ActionRuntimeResult } from '../lib/execute_action';
import type { ActionTypeExecutorResult, ConnectorTokenStore } from '../types';

export interface PreparedConnector {
  readonly kibanaVersion: string;
  readonly actionId: string;
  readonly actionTypeId: string;
  readonly name: string;
  readonly config: Record<string, unknown>;
  readonly secrets: Record<string, unknown>;
  readonly params: Record<string, unknown>;
  readonly runtimeConfig: RuntimeActionsConfig;
  readonly userAgent?: string;
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
  prepare(
    scopeId: string,
    invocationId: string,
    request: {
      readonly connectorType: string;
      readonly connectorNameOrId: string;
      readonly input: Record<string, unknown>;
    }
  ): Promise<ConnectorPreparation>;
  token(
    scopeId: string,
    invocationId: string,
    request: ConnectorTokenRequest
  ): Promise<ConnectorTokenResponse>;
  finalize(scopeId: string, results: ConnectorFinalization[]): Promise<void>;
}

export type ConnectorTokenRequest =
  | { readonly operation: 'acquireRefreshLock' | 'releaseRefreshLock' }
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
  readonly hasErrors: boolean;
  readonly connectorToken: Awaited<ReturnType<ConnectorTokenStore['get']>>['connectorToken'];
}

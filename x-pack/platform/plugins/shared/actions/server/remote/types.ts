/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AuthMode } from '@kbn/connector-specs-runtime';
import type { RuntimeActionsConfig } from '../actions_config';
import type { ActionRuntimeResult } from '../lib/execute_action';
import type { ActionTypeExecutorResult } from '../types';

export interface PreparedConnector {
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
  finalize(scopeId: string, results: ConnectorFinalization[]): Promise<void>;
}

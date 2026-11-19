/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import startsWith from 'lodash/startsWith';
import type { ActionType, ActionTypeExecutorOptions, ActionTypeExecutorRawResult } from '../types';
import type { ConnectorExecuteErrorType } from './connector_metrics';
import { getConnectorAuthType, recordConnectorAuth } from './connector_metrics';
import { ActionExecutionErrorReason } from './errors/action_execution_error';
import { validateAction } from './validate_action';
import type { RuntimeActionsConfig } from '../actions_config';

export type ActionRuntimeOptions = ActionTypeExecutorOptions<
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>
> & {
  readonly actionType: ActionType;
  readonly name: string;
  readonly runtimeConfig?: RuntimeActionsConfig;
  readonly runtimeUserAgent?: string;
  readonly authorize?: () => Promise<void>;
};
export interface ActionRuntimeResult {
  readonly validatedParams: Record<string, unknown>;
  readonly result: ActionTypeExecutorRawResult<unknown>;
  readonly errorType: ConnectorExecuteErrorType;
  readonly executionStartedAt: number;
  readonly executionCompletedAt: number;
  readonly handlerStarted: boolean;
  readonly validationError?: { readonly message: string };
}
export interface ActionRuntimeErrors {
  readonly isConnectorAuthorizationError: typeof import('@kbn/connector-specs').isConnectorAuthorizationError;
  readonly TaskErrorSource: typeof import('@kbn/task-manager-plugin/server').TaskErrorSource;
  readonly getErrorSource: (
    error: Error
  ) => import('@kbn/task-manager-plugin/server').TaskErrorSource | undefined;
}
export type ActionRuntime = (options: ActionRuntimeOptions) => Promise<ActionRuntimeResult>;

/** Runs the original Actions validation and connector executor inside the selected runtime. */
export const executeAction = async (
  options: Pick<
    ActionRuntimeOptions,
    | 'actionId'
    | 'actionType'
    | 'params'
    | 'config'
    | 'secrets'
    | 'taskInfo'
    | 'configurationUtilities'
    | 'name'
    | 'authorize'
  > & {
    readonly executor: (validated: {
      validatedParams: Record<string, unknown>;
      validatedConfig: Record<string, unknown>;
      validatedSecrets: Record<string, unknown>;
    }) => Promise<ActionTypeExecutorRawResult<unknown>>;
  },
  { TaskErrorSource, getErrorSource, isConnectorAuthorizationError }: ActionRuntimeErrors
): Promise<ActionRuntimeResult> => {
  const { actionId, actionType, params, config, secrets, taskInfo, configurationUtilities, name } =
    options;
  const actionTypeId = actionType.id;
  let validatedParams: Record<string, unknown>;
  let validatedConfig;
  let validatedSecrets;
  try {
    ({ validatedParams, validatedConfig, validatedSecrets } = validateAction(
      { actionId, actionType, params, config, secrets, taskInfo },
      { configurationUtilities },
      TaskErrorSource
    ));
  } catch (err) {
    return {
      validatedParams: params,
      result: err.result,
      validationError: { message: err.message },
      errorType: 'invalid',
      executionStartedAt: Date.now(),
      executionCompletedAt: Date.now(),
      handlerStarted: false,
    };
  }
  let rawResult: ActionTypeExecutorRawResult<unknown>;
  let errorType: ConnectorExecuteErrorType = 'other';
  const executionStartedAt = Date.now();
  let handlerStarted = false;
  try {
    await options.authorize?.();
    handlerStarted = true;
    rawResult = await options.executor({ validatedParams, validatedConfig, validatedSecrets });

    if (rawResult && rawResult.status === 'error') {
      rawResult.errorSource = TaskErrorSource.USER;
    }
  } catch (err) {
    ({ result: rawResult, errorType } = getActionRuntimeError(
      { error: err, actionId, actionTypeId, name, config, secrets },
      { TaskErrorSource, getErrorSource, isConnectorAuthorizationError }
    ));
  }

  return {
    validatedParams,
    result: rawResult || { actionId, status: 'ok' },
    errorType,
    executionStartedAt,
    executionCompletedAt: Date.now(),
    handlerStarted,
  };
};

/** Preserves Actions execution error classification for handler and runtime failures. */
export const getActionRuntimeError = (
  {
    error,
    actionId,
    actionTypeId,
    name,
    config,
    secrets,
  }: {
    readonly error: Error & {
      readonly reason?: string;
      readonly result?: ActionTypeExecutorRawResult<unknown>;
    };
    readonly actionId: string;
    readonly actionTypeId: string;
    readonly name: string;
    readonly config: Record<string, unknown>;
    readonly secrets: Record<string, unknown>;
  },
  { TaskErrorSource, getErrorSource, isConnectorAuthorizationError }: ActionRuntimeErrors
): Pick<ActionRuntimeResult, 'result' | 'errorType'> => {
  let rawResult: ActionTypeExecutorRawResult<unknown> | undefined;
  let errorType: ConnectorExecuteErrorType = 'other';
  const errorSource = startsWith(error.message, 'Client network socket disconnected')
    ? TaskErrorSource.USER
    : getErrorSource(error) || TaskErrorSource.FRAMEWORK;
  if (error.reason === ActionExecutionErrorReason.Authorization) {
    errorType = 'unauthorized';
    rawResult = error.result;
  } else if (isConnectorAuthorizationError(error)) {
    errorType = 'auth_failed';
    recordConnectorAuth({
      phase: 'execute',
      authType: getConnectorAuthType({ config, secrets }),
      connectorType: actionTypeId,
      errorType: 'authorization_failed',
    });
    rawResult = {
      actionId,
      status: 'error',
      message: 'an error occurred while running the action',
      serviceMessage: error.message,
      errorName: 'ConnectorAuthorizationError',
      errorMeta: {
        connectorName: name,
        authMethod: error.authMethod,
        reason: error.reason,
      },
      error,
      retry: false,
      errorSource: TaskErrorSource.USER,
    };
  } else {
    rawResult = {
      actionId,
      status: 'error',
      message: 'an error occurred while running the action',
      serviceMessage: error.message,
      error,
      retry: true,
      errorSource,
    };
  }
  return { result: rawResult || { actionId, status: 'ok' }, errorType };
};

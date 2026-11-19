/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ActionType, ValidatorServices } from '../types';
import type { TaskInfo } from './action_executor';
import { ActionExecutionError, ActionExecutionErrorReason } from './errors/action_execution_error';
import {
  validateConfig,
  validateConnector,
  validateParams,
  validateSecrets,
} from './validate_with_schema';

interface ValidateActionOpts {
  actionId: string;
  actionType: ActionType;
  params: Record<string, unknown>;
  config: Record<string, unknown>;
  secrets: Record<string, unknown>;
  taskInfo?: TaskInfo;
}

/** Validates original Actions inputs and preserves validation error classification and retry policy. */
export function validateAction(
  { actionId, actionType, params, config, secrets, taskInfo }: ValidateActionOpts,
  validatorServices: ValidatorServices,
  errorSources: Pick<
    typeof import('@kbn/task-manager-plugin/server').TaskErrorSource,
    'USER' | 'FRAMEWORK'
  >
): {
  validatedParams: Record<string, unknown>;
  validatedConfig: Record<string, unknown>;
  validatedSecrets: Record<string, unknown>;
} {
  let validatedParams: Record<string, unknown>;
  let validatedConfig: Record<string, unknown>;
  let validatedSecrets: Record<string, unknown>;

  try {
    // Params validator is guaranteed to exist at this point (validated in execute method)
    validatedParams = validateParams(actionType, params, validatorServices);
  } catch (err) {
    throw new ActionExecutionError(err.message, ActionExecutionErrorReason.Validation, {
      actionId,
      status: 'error',
      message: err.message,
      retry: !!taskInfo,
      errorSource: errorSources.USER,
    });
  }

  try {
    validatedConfig = validateConfig(actionType, config, validatorServices);
    validatedSecrets = validateSecrets(actionType, secrets, validatorServices);
    if (actionType.validate?.connector) {
      validateConnector(actionType, {
        config,
        secrets,
      });
    }

    return { validatedParams, validatedConfig, validatedSecrets };
  } catch (err) {
    throw new ActionExecutionError(err.message, ActionExecutionErrorReason.Validation, {
      actionId,
      status: 'error',
      message: err.message,
      retry: !!taskInfo,
      errorSource: errorSources.FRAMEWORK,
    });
  }
}

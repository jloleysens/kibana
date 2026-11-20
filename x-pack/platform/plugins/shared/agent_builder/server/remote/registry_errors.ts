/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { deserializeExecutionError, isAgentBuilderError } from '@kbn/agent-builder-common';
import type { SerializedExecutionError } from '@kbn/agent-builder-common';
import { serializeExecutionError } from '../services/execution/utils/serialize_execution_error';

/** Preserves public AgentBuilder errors without exporting private request or service metadata. */
export const createRegistryTransportError = (
  error: Parameters<typeof serializeExecutionError>[0]
): Error => {
  const serialized = serializeExecutionError(error);
  const ErrorType =
    [EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError].find(
      (Constructor) => error instanceof Constructor
    ) ?? Error;
  const transportError =
    error instanceof AggregateError
      ? new AggregateError([], serialized.message)
      : new ErrorType(serialized.message);
  Object.assign(transportError, {
    workflowAgentBuilderErrorName: error instanceof Error ? error.name : 'Error',
    workflowAgentBuilderWasTyped: isAgentBuilderError(error),
    workflowAgentBuilderError: serialized,
  });

  return transportError;
};

interface RegistryError extends Error {
  workflowAgentBuilderError?: SerializedExecutionError;
  workflowAgentBuilderWasTyped?: boolean;
  workflowAgentBuilderErrorName?: string;
}

/** Restores original AgentBuilder prototypes and builtin retry types after safe transport. */
export const restoreRegistryError = async <T>(result: Promise<T>): Promise<T> => {
  try {
    return await result;
  } catch (error) {
    if (error instanceof Error) {
      const registryError = error as RegistryError;
      if (registryError.workflowAgentBuilderWasTyped && registryError.workflowAgentBuilderError)
        throw deserializeExecutionError(registryError.workflowAgentBuilderError);
      if (registryError.workflowAgentBuilderErrorName)
        error.name = registryError.workflowAgentBuilderErrorName;
    }
    throw error;
  }
};

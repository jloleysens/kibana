/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ExecutionError } from '@kbn/workflows/server';
import {
  KiConflictError,
  KiDeletedError,
  KiNotFoundError,
  KiValidationError,
  AiIndexNotFoundError,
} from '../ai_indices/errors';
import { createRegistryTransportError } from './registry_errors';

export const createKiTransportError = (error: Error | string): Error =>
  Object.assign(createRegistryTransportError(error), {
    workflowKiExecutionType: error instanceof ExecutionError ? error.type : undefined,
  });

export const restoreKiError = async <T>(result: Promise<T>): Promise<T> => {
  try {
    return await result;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if ('workflowKiExecutionType' in error && typeof error.workflowKiExecutionType === 'string')
      throw new ExecutionError({ type: error.workflowKiExecutionType, message: error.message });
    const name =
      'workflowContextEngineErrorName' in error ? error.workflowContextEngineErrorName : error.name;
    const constructors = {
      KiConflictError: () => new KiConflictError('', ''),
      KiDeletedError: () => new KiDeletedError('', ''),
      KiNotFoundError: () => new KiNotFoundError('', ''),
      KiValidationError: () => new KiValidationError(error.message),
      AiIndexNotFoundError: () => new AiIndexNotFoundError(''),
    };
    const restored = Object.entries(constructors).find(([key]) => key === name)?.[1]();
    if (restored) {
      restored.message = error.message;
      throw restored;
    }
    if (typeof name === 'string') error.name = name;
    throw error;
  }
};

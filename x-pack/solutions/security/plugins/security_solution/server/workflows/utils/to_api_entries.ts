/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ExecutionError } from '@kbn/workflows-runtime';
import type { EntriesArray } from '@kbn/securitysolution-io-ts-list-types';
import type { ExceptionEntryInput } from '@kbn/securitysolution-exceptions-common/workflows';
import {
  MissingExceptionEntryOperandError,
  toApiEntries as toApiEntriesUnwrapped,
} from '../../../common/detection_engine/rule_exceptions/to_api_entries';

/**
 * Maps the step's flat, UI-verb entry shape (see `exceptionEntrySchema`) onto
 * the exceptions API's entry union, rewrapping the mapper's operand error as a
 * step `ValidationError`.
 */
export const toApiEntries = (entries: ExceptionEntryInput[]): EntriesArray => {
  try {
    return toApiEntriesUnwrapped(entries);
  } catch (error) {
    if (error instanceof MissingExceptionEntryOperandError) {
      throw new ExecutionError({ type: 'ValidationError', message: error.message });
    }
    throw error;
  }
};

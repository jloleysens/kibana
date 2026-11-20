/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { KiHandlerOperations } from '../step_types/ki_handler_operations';
import type { KiRevision } from '../ai_indices/ki_revision';
import type { KiRevisionOperations } from '../ai_indices/ki_write_algorithms';

export type KiWriteStepAction = 'create' | 'update' | 'delete';
export type KiWriteOutcome =
  | { id?: string }
  | { error: { message: string; type: string; aborted: boolean } };
export interface KiOperationsApi {
  assertEnabled(scopeId: string): Promise<void>;
  openWrite(scopeId: string, stepId: string, aiIndexId: string): Promise<string>;
  cancelWrite(scopeId: string, reference: string): Promise<void>;
  openVerification(scopeId: string): Promise<string>;
  cancelVerification(scopeId: string, reference: string): Promise<void>;
  authorizeWrite(scopeId: string, reference: string): Promise<void>;
  resolve(scopeId: string, reference: string): ReturnType<KiHandlerOperations['resolve']>;
  readRevision(
    scopeId: string,
    reference: string,
    kiId: string,
    includeSource: boolean
  ): Promise<{ reference: string; revision: KiRevision }>;
  writeRevision(
    scopeId: string,
    reference: string,
    revisionReference: string,
    changes: Parameters<KiRevisionOperations['write']>[0]['changes'],
    refresh: boolean
  ): ReturnType<KiRevisionOperations['write']>;
  putRevision(
    scopeId: string,
    reference: string,
    kiId: string,
    document: Parameters<KiHandlerOperations['put']>[0]['document'],
    refresh: boolean
  ): Promise<void>;
  finishWrite(scopeId: string, reference: string, outcome: KiWriteOutcome): Promise<void>;
  verify(
    scopeId: string,
    reference: string,
    params: Parameters<KiHandlerOperations['verifyKi']>[0]
  ): ReturnType<KiHandlerOperations['verifyKi']>;
}
export const KiOperationsToken = createToken<KiOperationsApi>('contextEngine.kiOperations');

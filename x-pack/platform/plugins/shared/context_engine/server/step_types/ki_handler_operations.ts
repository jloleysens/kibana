/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ExecutionError } from '@kbn/workflows/server';
import { isIndexPattern } from '../../common/is_index_pattern';
import type { AiIndexDest } from '../../common/http_api/ai_indices';
import type { putKiRevision } from '../ai_indices/ki_revision';
import type {
  updateKiWithRevisionOperations,
  softDeleteKiWithRevisionOperations,
} from '../ai_indices/ki_write_algorithms';
import type { VerifyKiParams, VerifyKi } from './verify_ki';
import type { ResolvedAiIndex, withKiWriteTelemetry } from './helpers';

export interface KiHandlerOperations {
  assertEnabled(): Promise<void>;
  checkWritePrivilege(): Promise<void>;
  resolve(aiIndexId: string): Promise<ResolvedAiIndex>;
  withTelemetry<Output extends { id?: string }>(
    aiIndexId: string,
    run: Parameters<typeof withKiWriteTelemetry<Output>>[0]['run']
  ): Promise<{ output: Output }>;
  verifyKi(params: Omit<VerifyKiParams, 'context'>): ReturnType<VerifyKi>;
  put(options: Omit<Parameters<typeof putKiRevision>[0], 'esClient'>): Promise<void>;
  update(
    options: Parameters<typeof updateKiWithRevisionOperations>[0]
  ): ReturnType<typeof updateKiWithRevisionOperations>;
  remove(
    options: Parameters<typeof softDeleteKiWithRevisionOperations>[0]
  ): ReturnType<typeof softDeleteKiWithRevisionOperations>;
}

/** Fails the step when the dest is an index pattern, which cannot be a write target. */
export const assertWritableDest = (aiIndexId: string, dest: AiIndexDest): void => {
  if (isIndexPattern(dest.value)) {
    throw new ExecutionError({
      type: 'ValidationError',
      message: `Cannot create a KI in AI index '${aiIndexId}': its dest is an index pattern, not a single write target`,
    });
  }
};

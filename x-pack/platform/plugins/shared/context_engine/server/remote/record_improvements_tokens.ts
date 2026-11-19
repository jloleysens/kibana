/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type {
  RecordImprovementsParams,
  recordImprovementsForIndex,
} from '../step_types/record_improvements_operation';

export interface RecordImprovementsOperationsApi {
  assertEnabled(scopeId: string): Promise<void>;
  checkWritePrivilege(scopeId: string): Promise<boolean>;
  record(
    scopeId: string,
    params: RecordImprovementsParams
  ): ReturnType<typeof recordImprovementsForIndex>;
}
export const RecordImprovementsOperationsToken = createToken<RecordImprovementsOperationsApi>(
  'contextEngine.recordImprovementsOperations'
);

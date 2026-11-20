/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ExecutionError } from '@kbn/workflows/server';
import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { recordImprovementsStepCommonDefinition } from '../../common/step_types/record_improvements';
import type {
  recordImprovementsForIndex,
  RecordImprovementsParams,
} from './record_improvements_operation';
import { assertFeedbackLoopEnabled } from './step_guards';

export interface RecordImprovementsHandlerDependencies {
  assertEnabled(): Promise<void>;
  isFeedbackLoopEnabled(): Promise<boolean>;
  checkWritePrivilege(): Promise<boolean>;
  record(params: RecordImprovementsParams): ReturnType<typeof recordImprovementsForIndex>;
}

export const createRecordImprovementsHandler =
  ({
    assertEnabled,
    isFeedbackLoopEnabled,
    checkWritePrivilege,
    record,
  }: RecordImprovementsHandlerDependencies) =>
  async (
    context: StepHandlerContext<
      typeof recordImprovementsStepCommonDefinition.inputSchema,
      typeof recordImprovementsStepCommonDefinition.outputSchema
    >
  ) => {
    await assertEnabled();
    await assertFeedbackLoopEnabled(isFeedbackLoopEnabled);
    await assertRecordImprovementsWritePrivilege(checkWritePrivilege);
    const {
      ai_index_id: aiIndexId,
      agent_run_id: agentRunId,
      signal_window: signalWindow,
      signal_spaces: signalSpaces,
      improvements,
    } = context.input;
    return {
      output: await record({
        aiIndexId,
        agentRunId,
        signalWindow,
        signalSpaces,
        proposals: improvements,
      }),
    };
  };

export const assertRecordImprovementsWritePrivilege = async (
  checkWritePrivilege: () => Promise<boolean>
): Promise<void> => {
  if (!(await checkWritePrivilege())) {
    throw new ExecutionError({
      type: 'PermissionError',
      message: 'Insufficient privileges to record Context Engine improvements',
    });
  }
};

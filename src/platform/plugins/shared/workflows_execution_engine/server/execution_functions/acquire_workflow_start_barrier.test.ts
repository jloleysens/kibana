/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { EsWorkflowExecution } from '@kbn/workflows';
import { ExecutionStatus } from '@kbn/workflows-runtime';
import { acquireWorkflowStartBarrier } from './acquire_workflow_start_barrier';
import {
  createMockStepDataClient,
  createMockWorkflowDataClient,
} from '../repositories/data_access_layer/mocks';
import { StepExecutionRepository } from '../repositories/step_execution_repository';
import { WorkflowExecutionRepository } from '../repositories/workflow_execution_repository';

const setup = () => {
  let document: EsWorkflowExecution = {
    id: 'run',
    workflowId: 'workflow',
    spaceId: 'default',
    isTestRun: false,
    status: ExecutionStatus.PENDING,
    context: {},
    yaml: '',
    scopeStack: [],
    createdAt: '2026-11-17T00:00:00Z',
    startedAt: '',
    finishedAt: '',
    cancelRequested: false,
    duration: 0,
    error: null,
    workflowDefinition: {
      version: '1',
      name: 'Barrier',
      enabled: true,
      triggers: [{ type: 'manual' }],
      steps: [],
    },
  };
  let seqNo = 0;
  const workflowExecutionRepository = new WorkflowExecutionRepository(
    createMockWorkflowDataClient()
  );
  const stepExecutionRepository = new StepExecutionRepository(createMockStepDataClient());
  jest
    .spyOn(workflowExecutionRepository, 'getWorkflowExecutionWithVersion')
    .mockImplementation(async () => ({
      execution: structuredClone(document),
      seqNo,
      primaryTerm: 1,
    }));
  const update = jest
    .spyOn(workflowExecutionRepository, 'tryUpdateWorkflowExecutionWithVersion')
    .mockImplementation(async (partial, revision) => {
      if (revision.seqNo !== seqNo) return false;
      document = { ...document, ...partial };
      seqNo++;
      return true;
    });
  const steps = jest
    .spyOn(stepExecutionRepository, 'hasStepExecutionsForWorkflow')
    .mockResolvedValue(false);
  const params = {
    workflowRunId: 'run',
    spaceId: 'default',
    workflowExecutionRepository,
    stepExecutionRepository,
  };
  return {
    params,
    update,
    steps,
    setEvidence: (partial: Partial<EsWorkflowExecution>) => {
      document = { ...document, ...partial };
    },
  };
};

it('allows exactly one of two concurrent starts through the same execution revision', async () => {
  const { params, update } = setup();
  const outcomes = await Promise.all([
    acquireWorkflowStartBarrier(params),
    acquireWorkflowStartBarrier(params),
  ]);
  expect(outcomes.filter((outcome) => outcome.acquired)).toHaveLength(1);
  expect(outcomes.filter((outcome) => !outcome.acquired)).toHaveLength(1);
  expect(update).toHaveBeenCalledWith(
    { id: 'run', startedAt: expect.any(String) },
    { seqNo: 0, primaryTerm: 1 },
    { refresh: false }
  );
});

it.each([
  { startedAt: '2026-11-17T00:00:00Z' },
  { currentNodeId: 'first' },
  { stepExecutionIds: ['first'] },
  { status: ExecutionStatus.RUNNING },
  { status: ExecutionStatus.CANCELLED },
])('refuses an execution with start evidence %j', async (evidence) => {
  const { params, update, setEvidence } = setup();
  setEvidence(evidence);
  expect(await acquireWorkflowStartBarrier(params)).toEqual({ acquired: false });
  expect(update).not.toHaveBeenCalled();
});

it('refuses a pending execution with an unreferenced persisted step', async () => {
  const { params, update, steps } = setup();
  steps.mockResolvedValue(true);
  expect(await acquireWorkflowStartBarrier(params)).toEqual({ acquired: false });
  expect(update).not.toHaveBeenCalled();
});

it('throws on sustained CAS contention instead of running without a barrier', async () => {
  const { params, update } = setup();
  update.mockResolvedValue(false);
  await expect(acquireWorkflowStartBarrier(params)).rejects.toThrow('contention');
  expect(update).toHaveBeenCalledTimes(3);
});

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License, v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { MessageChannel } from 'node:worker_threads';
import { expose, openPortSession } from '@kbn/core-remote-common';
import { loggerMock } from '@kbn/logging-mocks';
import type { EsWorkflowExecution } from '@kbn/workflows';
import { ExecutionStatus } from '@kbn/workflows-runtime';
import { ExecutorStorage } from './executor_storage';
import type { WorkflowControlApi, WorkflowDataPlaneApi } from './tokens';
import { WorkflowControl } from './workflow_control';
import { WorkflowStorage } from './workflow_storage';
import {
  createMockStepDataClient,
  createMockWorkflowDataClient,
} from '../repositories/data_access_layer/mocks';
import { StepExecutionRepository } from '../repositories/step_execution_repository';
import { WorkflowExecutionRepository } from '../repositories/workflow_execution_repository';

it('lazily reuses the coordinator DAL capability for data streams over loopback', async () => {
  const executions = new WorkflowExecutionRepository(createMockWorkflowDataClient());
  const steps = new StepExecutionRepository(createMockStepDataClient());
  const execution = {
    id: 'run',
    spaceId: 'default',
    status: ExecutionStatus.RUNNING,
  } as EsWorkflowExecution;
  jest.spyOn(executions, 'getWorkflowExecutionById').mockResolvedValue(execution);
  const update = jest.spyOn(executions, 'updateWorkflowExecution').mockResolvedValue();
  jest.spyOn(steps, 'getStepExecutionsByIds').mockResolvedValue([]);
  const callbacks = { scheduleResume: jest.fn(), executeConnector: jest.fn() };
  const storage = new WorkflowStorage(executions, steps, loggerMock.create(), callbacks);
  const persistence = jest.fn(async () => storage);
  const control = new WorkflowControl({
    ...callbacks,
    persistence,
    initializeLogs: jest.fn(),
    info: jest.fn(),
  });
  const { port1, port2 } = new MessageChannel();
  const client = openPortSession<WorkflowControlApi>(port1, {});
  openPortSession(port2, expose(control));
  const data: WorkflowDataPlaneApi = {
    open: jest.fn(),
    close: jest.fn(),
    internal: jest.fn(),
    user: jest.fn(),
  };
  const worker = new ExecutorStorage(data, client);
  expect(persistence).not.toHaveBeenCalled();
  try {
    expect(await worker.getExecution('scope', 'run', 'default')).toEqual(execution);
    expect(await worker.getSteps('scope', ['step'])).toEqual([]);
    await worker.updateExecution('scope', { id: 'run', status: ExecutionStatus.WAITING_FOR_CHILD });
    expect(persistence).toHaveBeenCalledTimes(1);
    expect(data.internal).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      { id: 'run', status: ExecutionStatus.WAITING_FOR_CHILD },
      { refresh: 'wait_for' }
    );
  } finally {
    client[Symbol.dispose]();
    port1.close();
    port2.close();
  }
});

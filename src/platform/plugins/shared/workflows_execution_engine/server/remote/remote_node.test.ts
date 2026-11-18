/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { ExecutionStatus } from '@kbn/workflows-runtime';
import { createRemoteNode } from './remote_node';
import type { WorkflowStepRunnerApi } from './tokens';
import type { StepExecutionRuntime } from '../workflow_context_manager/step_execution_runtime';
import type { StepIoService } from '../workflow_context_manager/step_io_service';
import type { WorkflowExecutionRuntimeManager } from '../workflow_context_manager/workflow_execution_runtime_manager';

const setup = () => {
  const runtime = {
    stepExecution: { status: ExecutionStatus.RUNNING },
    stepExecutionId: 'step',
    workflowExecution: { id: 'run', spaceId: 'default' },
    node: { id: 'node' },
    scopeStack: { stackFrames: [] },
    abortController: new AbortController(),
    contextManager: { getContext: () => ({ now: new Date() }) },
    stepLogger: { logWarn: jest.fn() },
    startStep: jest.fn(),
    failStep: jest.fn(),
    recordTokenUsage: jest.fn(),
    getCurrentStepResult: jest.fn(() => ({ output: { metadata: { usage: { total_tokens: 7 } } } })),
  } as unknown as StepExecutionRuntime;
  const workflowRuntime = {
    navigateToNextNode: jest.fn(),
  } as unknown as WorkflowExecutionRuntimeManager;
  const io = {
    flush: jest.fn().mockResolvedValue(undefined),
    loadStep: jest.fn().mockResolvedValue(undefined),
  };
  const runner: jest.Mocked<WorkflowStepRunnerApi> = {
    describe: jest.fn(),
    invoke: jest.fn(),
    cancel: jest.fn(),
  };
  const node = createRemoteNode({
    description: {
      type: 'workflow.execute',
      mode: 'node',
      digest: 'test',
      configKeys: [],
      hasStart: false,
      hasOnCancel: false,
    },
    runner,
    runtime,
    workflowRuntime,
    stepIoService: io as unknown as StepIoService,
    scopeId: 'scope',
  });
  return { node, runtime, workflowRuntime, io, runner };
};

it('reloads only the completed node and accounts for output usage without repeating its phase', async () => {
  const { node, runtime, workflowRuntime, io, runner } = setup();
  io.loadStep.mockImplementation(async () => {
    Object.assign(runtime.stepExecution ?? {}, { status: ExecutionStatus.COMPLETED });
  });
  await node.run();
  expect(runner.invoke).toHaveBeenCalledTimes(1);
  expect(io.loadStep).toHaveBeenCalledWith('step');
  expect(runtime.recordTokenUsage).toHaveBeenCalledWith({
    metadata: { usage: { total_tokens: 7 } },
  });
  expect(workflowRuntime.navigateToNextNode).toHaveBeenCalledTimes(1);
});

it('waits for a cancelled child-start phase to persist its id before reconstructing cancellation', async () => {
  const { node, runtime, io, runner } = setup();
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  runner.invoke.mockImplementationOnce(async () => {
    started.resolve();
    await finish.promise;
  });
  const running = node.run();
  await started.promise;
  runtime.abortController.abort();
  const cancelling = node.onCancel();
  await new Promise((resolve) => setImmediate(resolve));
  expect(runner.invoke).toHaveBeenCalledTimes(1);
  expect(runner.cancel).toHaveBeenCalledTimes(1);
  finish.resolve();
  await Promise.all([running, cancelling]);
  expect(runner.invoke).toHaveBeenLastCalledWith(
    expect.objectContaining({ phase: 'nodeCancel', aborted: true })
  );
  expect(io.loadStep).not.toHaveBeenCalled();
});

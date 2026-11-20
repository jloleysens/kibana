/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { NodesFactory } from './nodes_factory';
import { StepExecutionRuntime } from '../workflow_context_manager/step_execution_runtime';
import { createMockWorkflowEventLogger } from '../workflow_event_logger/mocks';

const setup = (remote: boolean, stepType = 'kibana.request') => {
  const logger = createMockWorkflowEventLogger();
  const remoteNode = { run: jest.fn() };
  const dependencies = {} as ConstructorParameters<typeof NodesFactory>[5];
  dependencies.remoteNode = jest.fn(() => (remote ? remoteNode : undefined));
  const factory = new NodesFactory(
    {} as ConstructorParameters<typeof NodesFactory>[0],
    {} as ConstructorParameters<typeof NodesFactory>[1],
    logger,
    {} as ConstructorParameters<typeof NodesFactory>[3],
    {} as ConstructorParameters<typeof NodesFactory>[4],
    dependencies,
    {} as ConstructorParameters<typeof NodesFactory>[6]
  );
  type RuntimeInit = ConstructorParameters<typeof StepExecutionRuntime>[0];
  const runtime = new StepExecutionRuntime({
    node: {
      type: 'atomic',
      id: 'request',
      stepId: 'request',
      stepType,
      configuration: { name: 'request', type: stepType },
    },
    stepLogger: logger,
    stepExecutionId: 'step-exec',
    stackFrames: [],
    workflowExecutionGraph: {} as RuntimeInit['workflowExecutionGraph'],
    contextManager: {} as RuntimeInit['contextManager'],
    workflowExecutionState: {} as RuntimeInit['workflowExecutionState'],
    stepIoService: {} as RuntimeInit['stepIoService'],
  });
  return { factory, logger, remoteNode, runtime };
};

it.each([false, true])(
  'emits the exact original Kibana factory diagnostic once (remote=%s)',
  async (remote) => {
    const { factory, logger, runtime } = setup(remote);
    await factory.create(runtime);
    expect(logger.logDebug.mock.calls).toEqual([
      [
        'Creating Kibana action step: kibana.request',
        {
          event: { action: 'internal-action-creation', outcome: 'success' },
          tags: ['step-factory', 'kibana', 'internal-action'],
        },
      ],
    ]);
  }
);

it('leaves other remote node diagnostics unchanged', async () => {
  const { factory, logger, runtime, remoteNode } = setup(true, 'ai.agent');
  expect(await factory.create(runtime)).toBe(remoteNode);
  expect(logger.logDebug).not.toHaveBeenCalled();
});

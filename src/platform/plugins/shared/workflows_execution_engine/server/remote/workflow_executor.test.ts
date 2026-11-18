/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  type EsWorkflow,
  type EsWorkflowExecution,
  type EsWorkflowStepExecution,
  ExecutionStatus,
} from '@kbn/workflows';
import type {
  WorkflowChildApi,
  WorkflowDataPlaneApi,
  WorkflowLogApi,
  WorkflowStepCatalogApi,
  WorkflowStepRunnerApi,
  WorkflowStorageApi,
} from './tokens';
import { WorkflowExecutor } from './workflow_executor';
import { workflowDefinitionHash } from '../workflow_context_manager/step_dependency_plan';

jest.setTimeout(60_000);

const GRAPH = 'security.buildAlertEntityGraph';
const CASE = 'cases.createCase';

describe('WorkflowExecutor', () => {
  it('parks a long wait and resumes the case from the saved graph output', async () => {
    const store = createStore(execution());
    const caseTitles: string[] = [];
    const steps = catalog(caseTitles);
    const executor = new WorkflowExecutor(steps, store.storage, log());

    const parked = await executor.run({
      dependencyPlan: store.dependencyPlan,
      scopeId: 'scope-1',
      workflowRunId: 'run-1',
      spaceId: 'default',
    });

    expect(parked.status).toBe(ExecutionStatus.WAITING);
    expect(store.scheduled).toHaveLength(1);
    expect(caseTitles).toEqual([]);

    const continued = await executor.run({
      dependencyPlan: store.dependencyPlan,
      scopeId: 'scope-2',
      workflowRunId: 'run-1',
      spaceId: 'default',
    });

    expect(continued.status).toBe(ExecutionStatus.COMPLETED);
    expect(caseTitles).toEqual(['Graph nodes 2']);
  });

  it('refuses to start a pending execution without a durable start barrier', async () => {
    const job = execution([{ name: 'native', type: GRAPH, with: {} }]);
    job.startedAt = '';
    const store = createStore(job);
    const steps = catalog([]);
    await expect(
      new WorkflowExecutor(steps, store.storage, log()).run({
        dependencyPlan: store.dependencyPlan,
        scopeId: 'scope-1',
        workflowRunId: 'run-1',
        spaceId: 'default',
      })
    ).rejects.toThrow('durable start barrier');
    expect(steps.run).not.toHaveBeenCalled();
  });

  it('rejects a dependency plan from a different definition before invoking steps', async () => {
    const store = createStore(execution([{ name: 'native', type: GRAPH, with: {} }]));
    const steps = catalog([]);
    await expect(
      new WorkflowExecutor(steps, store.storage, log()).run({
        dependencyPlan: { ...store.dependencyPlan, definitionHash: 'stale' },
        scopeId: 'scope',
        workflowRunId: 'run-1',
        spaceId: 'default',
      })
    ).rejects.toThrow('dependency plan does not match');
    expect(steps.run).not.toHaveBeenCalled();
  });

  it('does not request coordinator metadata for a core-only execution', async () => {
    const store = createStore(
      execution([{ name: 'native', type: 'data.set', with: { value: 1 } }])
    );
    const stepRunner = { describe: jest.fn(), invoke: jest.fn(), cancel: jest.fn() };
    const result = await new WorkflowExecutor(
      catalog([]),
      store.storage,
      log(),
      undefined,
      stepRunner
    ).run({
      dependencyPlan: store.dependencyPlan,
      scopeId: 'scope-1',
      workflowRunId: 'run-1',
      spaceId: 'default',
    });
    expect(result.status).toBe(ExecutionStatus.COMPLETED);
    expect(stepRunner.describe).not.toHaveBeenCalled();
  });

  it('passes executor-local synchronous helpers to native contributions', async () => {
    const store = createStore(execution([{ name: 'native', type: GRAPH, with: {} }]));
    const steps = catalog([]);
    steps.run.mockImplementation(async (_type, _scopeId, _input, { handlerContext }) => {
      if (!handlerContext) throw new Error('Missing executor-local handler context');
      expect(handlerContext.stepId).toBe('native');
      expect(handlerContext.contextManager.renderInputTemplate('run {{ workflow.id }}')).toBe(
        'run remote-heap-measurement'
      );
      return { output: { native: true } };
    });
    const result = await new WorkflowExecutor(steps, store.storage, log()).run({
      dependencyPlan: store.dependencyPlan,
      scopeId: 'scope-1',
      workflowRunId: 'run-1',
      spaceId: 'default',
    });
    expect(result.status).toBe(ExecutionStatus.COMPLETED);
    expect(steps.run).toHaveBeenCalledTimes(1);
  });

  it('cooperatively cancels a reached native step and releases its scope', async () => {
    const store = createStore(execution([{ name: 'native', type: GRAPH, with: {} }]));
    const steps = catalog([]);
    let reached: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    steps.run.mockImplementation(async (_type, _scopeId, _input, { handlerContext }) => {
      if (!handlerContext) throw new Error('Missing executor-local handler context');
      return new Promise((resolve) => {
        handlerContext.abortSignal.addEventListener('abort', () => resolve({ output: null }), {
          once: true,
        });
        reached();
      });
    });
    const executor = new WorkflowExecutor(steps, store.storage, log());
    const pending = executor.run({
      dependencyPlan: store.dependencyPlan,
      scopeId: 'scope-1',
      workflowRunId: 'run-1',
      spaceId: 'default',
    });
    await started;
    await executor.cancel('scope-1', 'task_manager');
    expect((await pending).status).toBe(ExecutionStatus.CANCELLED);
    const persisted = await store.storage.getExecution('scope-1', 'run-1', 'default');
    expect(persisted.cancellationReason).toBe('Cancelled because Task Manager aborted the task');
    expect(persisted.cancelledBy).toBe('system');
    expect(
      (
        await executor.run({
          dependencyPlan: store.dependencyPlan,
          scopeId: 'scope-1',
          workflowRunId: 'run-1',
          spaceId: 'default',
        })
      ).status
    ).toBe(ExecutionStatus.CANCELLED);
  });

  it('preserves returned native handler errors instead of completing successfully', async () => {
    const store = createStore(execution([{ name: 'native', type: GRAPH, with: {} }]));
    const steps = catalog([]);
    steps.run.mockResolvedValue({ error: new Error('Native data validation failed') });
    const result = await new WorkflowExecutor(steps, store.storage, log()).run({
      dependencyPlan: store.dependencyPlan,
      scopeId: 'scope-1',
      workflowRunId: 'run-1',
      spaceId: 'default',
    });
    expect(result.status).toBe(ExecutionStatus.FAILED);
    expect(result.failedStepContext).toEqual({
      stepId: 'native',
      stepName: 'native',
      stepExecutionId: expect.any(String),
    });
    expect((await store.storage.getExecution('scope-1', 'run-1', 'default')).status).toBe(
      ExecutionStatus.FAILED
    );
  });

  it('awaits in-flight execution references before a coordinator reads a fast native output', async () => {
    const store = createStore(
      execution([
        { name: 'delay', type: GRAPH, with: {} },
        { name: 'seed', type: 'data.set', with: { value: 'current' } },
        { name: 'inspect', type: 'test.inspect', with: { value: '{{ steps.seed.output.value }}' } },
      ])
    );
    const update = store.storage.updateExecution;
    const backgroundSnapshot = Promise.withResolvers<void>();
    let heldSnapshot = false;
    jest.spyOn(store.storage, 'updateExecution').mockImplementation(async (...args) => {
      if (!heldSnapshot && args[1].stepExecutionIds?.length === 1) {
        heldSnapshot = true;
        backgroundSnapshot.resolve();
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return update(...args);
    });
    const nativeSteps = catalog([]);
    nativeSteps.run.mockImplementation(async () => {
      await backgroundSnapshot.promise;
      return { output: 'released' };
    });
    const runner = {
      describe: jest.fn(async () => [
        {
          type: 'test.inspect',
          mode: 'handler' as const,
          configKeys: [],
          hasStart: false,
          hasOnCancel: false,
          digest: 'test',
        },
      ]),
      invoke: jest.fn(async () => {
        // Coordinator preparation may yield while an older background snapshot is still writing.
        await new Promise((resolve) => setTimeout(resolve, 75));
        const persisted = await store.storage.getExecution('scope', 'run-1', 'default');
        const docs = await store.storage.getSteps('scope', persisted.stepExecutionIds ?? []);
        expect(docs.find(({ stepId }) => stepId === 'seed')?.output).toEqual({ value: 'current' });
        return { output: 'observed' };
      }),
      cancel: jest.fn(),
    };
    const result = await new WorkflowExecutor(
      nativeSteps,
      store.storage,
      log(),
      undefined,
      runner
    ).run({
      dependencyPlan: store.dependencyPlan,
      scopeId: 'scope',
      workflowRunId: 'run-1',
      spaceId: 'default',
    });
    expect(result.status).toBe(ExecutionStatus.COMPLETED);
    expect(runner.invoke).toHaveBeenCalledTimes(1);
  });

  it.each(['workflow.execute', 'workflow.executeAsync'])(
    'runs the original %s step in this isolate without a generic coordinator phase',
    async (type) => {
      const store = createStore(
        execution([
          {
            name: 'child',
            type,
            with: { 'workflow-id': 'child-definition', inputs: { answer: 42 } },
          },
        ])
      );
      const childExecution = {
        ...execution(),
        id: 'child-run',
        status: ExecutionStatus.COMPLETED,
        context: { output: { value: 'child-result' } },
      };
      const children: WorkflowChildApi = {
        getWorkflow: jest.fn(
          async () =>
            ({
              id: 'child-definition',
              name: 'Child',
              enabled: true,
              valid: true,
              definition: {},
              yaml: '',
            } as EsWorkflow)
        ),
        start: jest.fn(async () => ({ workflowExecutionId: 'child-run' })),
        getExecution: jest.fn(async () => childExecution),
        getSteps: jest.fn(async () => []),
        cancel: jest.fn(async () => {}),
      };
      const runner: WorkflowStepRunnerApi = {
        describe: jest.fn(async () => [
          {
            type,
            mode: 'node' as const,
            configKeys: [],
            hasStart: false,
            hasOnCancel: true,
            digest: 'test',
          },
        ]),
        invoke: jest.fn(async () => {
          throw new Error('Generic child phase must not run');
        }),
        cancel: jest.fn(),
      };
      const executor = new WorkflowExecutor(
        catalog([]),
        store.storage,
        log(),
        undefined,
        runner,
        children
      );
      const request = {
        scopeId: 'scope',
        workflowRunId: 'run-1',
        spaceId: 'default',
        dependencyPlan: store.dependencyPlan,
        facts: {
          kibanaUrl: 'http://kibana',
          maxResponseSizeBytes: 1024,
          evictionMinBytes: 128,
          maxWorkflowDepth: 10,
        },
      };
      const first = await executor.run(request);
      if (type === 'workflow.execute') {
        expect(first.status).toBe(ExecutionStatus.WAITING_FOR_CHILD);
        expect((await executor.run({ ...request, scopeId: 'resumed' })).status).toBe(
          ExecutionStatus.COMPLETED
        );
      } else {
        expect(first.status).toBe(ExecutionStatus.COMPLETED);
      }
      expect(children.start).toHaveBeenCalledTimes(1);
      expect(children.start).toHaveBeenCalledWith(
        'scope',
        'run-1',
        'default',
        expect.objectContaining({
          workflowId: 'child-definition',
          inputs: { answer: 42 },
          invocation: type === 'workflow.execute' ? 'sync' : 'async',
        })
      );
      expect(runner.invoke).not.toHaveBeenCalled();
      const persisted = await store.storage.getExecution('scope', 'run-1', 'default');
      const docs = await store.storage.getSteps('scope', persisted.stepExecutionIds ?? []);
      expect(docs.find(({ stepId }) => stepId === 'child')?.output).toEqual(
        type === 'workflow.execute'
          ? { value: 'child-result' }
          : expect.objectContaining({ awaited: false, executionId: 'child-run' })
      );
    }
  );

  it('persists parallel branch progress and gathers both branch outputs', async () => {
    const store = createStore(
      execution([
        {
          name: 'branches',
          type: 'parallel',
          branches: [
            {
              name: 'left',
              steps: [{ name: 'left_value', type: 'data.set', with: { value: 'left' } }],
            },
            {
              name: 'right',
              steps: [{ name: 'right_value', type: 'data.set', with: { value: 'right' } }],
            },
          ],
        },
      ])
    );
    const executor = new WorkflowExecutor(catalog([]), store.storage, log());
    const result = await executor.run({
      dependencyPlan: store.dependencyPlan,
      scopeId: 'scope',
      workflowRunId: 'run-1',
      spaceId: 'default',
    });
    expect(result.status).toBe(ExecutionStatus.COMPLETED);
    const persisted = await store.storage.getExecution('scope', 'run-1', 'default');
    const docs = await store.storage.getSteps('scope', persisted.stepExecutionIds ?? []);
    expect(docs.find(({ stepId }) => stepId === 'branches')?.state).toEqual(
      expect.objectContaining({
        branches: expect.arrayContaining([
          expect.objectContaining({ status: 'completed', key: 'left' }),
          expect.objectContaining({ status: 'completed', key: 'right' }),
        ]),
      })
    );
    expect(
      docs.filter(({ stepType }) => stepType === 'data.set').map(({ output }) => output)
    ).toEqual(expect.arrayContaining([{ value: 'left' }, { value: 'right' }]));
  });

  it.each(['waitForInput', 'waitForApproval'])(
    'parks %s and consumes resumeInput',
    async (type) => {
      const store = createStore(
        execution([
          {
            name: 'human',
            type,
            with: {
              message: 'Continue?',
              ...(type === 'waitForInput' ? { schema: { type: 'object' } } : {}),
            },
          },
        ])
      );
      const executor = new WorkflowExecutor(catalog([]), store.storage, log());
      const run = () =>
        executor.run({
          dependencyPlan: store.dependencyPlan,
          scopeId: 'scope',
          workflowRunId: 'run-1',
          spaceId: 'default',
        });
      expect((await run()).status).toBe(ExecutionStatus.WAITING_FOR_INPUT);
      const parked = await store.storage.getExecution('scope', 'run-1', 'default');
      await store.storage.updateExecution('scope', {
        id: parked.id,
        context: { ...parked.context, resumeInput: { approved: true, value: 'human' } },
      });
      expect((await run()).status).toBe(ExecutionStatus.COMPLETED);
      const completed = await store.storage.getExecution('scope', 'run-1', 'default');
      const docs = await store.storage.getSteps('scope', completed.stepExecutionIds ?? []);
      expect(docs.find(({ stepId }) => stepId === 'human')?.output).toBeDefined();
    }
  );

  it('rejects an unregistered step before earlier steps run', async () => {
    const store = createStore(
      execution([
        { name: 'graph', type: GRAPH, with: { alertId: 'a', alertIndex: 'alerts' } },
        { name: 'print', type: 'console', with: { message: 'hi' } },
      ])
    );
    const steps = catalog([]);
    const executor = new WorkflowExecutor(steps, store.storage, log());

    await expect(
      executor.run({
        dependencyPlan: store.dependencyPlan,
        scopeId: 'scope-1',
        workflowRunId: 'run-1',
        spaceId: 'default',
      })
    ).rejects.toThrow(/Unsupported remote step type "console"/);
    expect(steps.run).not.toHaveBeenCalled();
    expect(store.completed).toEqual([ExecutionStatus.FAILED]);
  });
  it.each([
    {
      name: 'else',
      step: { name: 'branch', type: 'if', steps: [], else: [{ name: 'missing', type: 'missing' }] },
    },
    {
      name: 'switch case',
      step: {
        name: 'branch',
        type: 'switch',
        cases: [{ steps: [{ name: 'missing', type: 'missing' }] }],
      },
    },
    {
      name: 'switch default',
      step: { name: 'branch', type: 'switch', default: [{ name: 'missing', type: 'missing' }] },
    },
    {
      name: 'fallback',
      step: {
        name: 'data',
        type: 'data.set',
        'on-failure': { fallback: [{ name: 'missing', type: 'missing' }] },
      },
    },
  ])('validates an unvisited $name reference before any step executes', async ({ step }) => {
    const store = createStore(execution([{ name: 'earlier', type: GRAPH }, step]));
    const steps = catalog([]);
    const executor = new WorkflowExecutor(steps, store.storage, log());
    await expect(
      executor.run({
        dependencyPlan: store.dependencyPlan,
        scopeId: 'scope',
        workflowRunId: 'run-1',
        spaceId: 'default',
      })
    ).rejects.toThrow('Unsupported remote step type "missing"');
    expect(steps.run).not.toHaveBeenCalled();
    expect(store.completed).toEqual([ExecutionStatus.FAILED]);
  });
  it('aborts an active native step and closes clients when its host is disposed', async () => {
    const store = createStore(execution([{ name: 'native', type: GRAPH, with: {} }]));
    const steps = catalog([]);
    let started: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let signal: AbortSignal | undefined;
    steps.run.mockImplementation(async (_type, _scope, _input, context) => {
      if (!context.handlerContext) throw new Error('Missing handler context');
      signal = context.handlerContext.abortSignal;
      started();
      await new Promise<void>((resolve) =>
        signal?.addEventListener('abort', () => resolve(), { once: true })
      );
      return { output: null };
    });
    const data: WorkflowDataPlaneApi = {
      open: jest.fn(),
      close: jest.fn(),
      internal: jest.fn(),
      user: jest.fn(),
    };
    const executor = new WorkflowExecutor(steps, store.storage, log(), data);
    const running = executor.run({
      dependencyPlan: store.dependencyPlan,
      scopeId: 'scope',
      workflowRunId: 'run-1',
      spaceId: 'default',
    });
    await ready;
    await executor[Symbol.asyncDispose]();
    expect(data.close).toHaveBeenCalledWith('scope');
    await running;
    expect(signal?.aborted).toBe(true);
    await expect(
      executor.run({
        dependencyPlan: store.dependencyPlan,
        scopeId: 'scope',
        workflowRunId: 'run-1',
        spaceId: 'default',
      })
    ).rejects.toThrow('disposed');
  });

  it('closes dispatch-scoped clients when the initial execution read fails', async () => {
    const store = createStore(execution());
    jest.spyOn(store.storage, 'getExecution').mockRejectedValue(new Error('read failed'));
    const data: WorkflowDataPlaneApi = {
      open: jest.fn(),
      close: jest.fn(),
      internal: jest.fn(),
      user: jest.fn(),
    };
    const executor = new WorkflowExecutor(catalog([]), store.storage, log(), data);
    await expect(
      executor.run({
        dependencyPlan: store.dependencyPlan,
        scopeId: 'scope',
        workflowRunId: 'run-1',
        spaceId: 'default',
      })
    ).rejects.toThrow('read failed');
    expect(data.close).toHaveBeenCalledWith('scope');
  });
});

function log(): WorkflowLogApi {
  return { info: jest.fn(), write: jest.fn() };
}

function catalog(caseTitles: string[]): jest.Mocked<WorkflowStepCatalogApi> {
  return {
    supports: jest.fn((stepType: string) => stepType === GRAPH || stepType === CASE),
    run: jest.fn(async (stepType: string, _scopeId: string, input: unknown) => {
      if (stepType === GRAPH) {
        return { output: { stats: { nodes: 2 }, alerts: [], nodes: [], edges: [] } };
      }
      const title = (input as { with?: { title?: string } }).with?.title ?? '';
      caseTitles.push(title);
      return { output: { case: { title } } };
    }),
  } as unknown as jest.Mocked<WorkflowStepCatalogApi>;
}

function execution(stepOverride?: unknown[]): EsWorkflowExecution {
  return {
    id: 'run-1',
    spaceId: 'default',
    startedAt: new Date().toISOString(),
    workflowId: 'remote-heap-measurement',
    status: ExecutionStatus.PENDING,
    workflowDefinition: {
      version: '1',
      name: 'Remote heap measurement',
      enabled: true,
      triggers: [{ type: 'manual' }],
      steps: [
        {
          name: 'graph',
          type: GRAPH,
          with: { alertId: 'alert-remote-heap', alertIndex: 'alerts-remote-heap' },
        },
        { name: 'pause', type: 'wait', with: { duration: '6s' } },
        {
          name: 'case',
          type: CASE,
          with: {
            title: 'Graph nodes {{ steps.graph.output.stats.nodes }}',
            description: 'Created after the alert graph step',
            owner: 'securitySolution',
            severity: 'low',
          },
        },
      ],
      ...(stepOverride ? { steps: stepOverride } : {}),
    },
  } as EsWorkflowExecution;
}

function createStore(initial: EsWorkflowExecution) {
  let current = structuredClone(initial);
  const stepDocs = new Map<string, EsWorkflowStepExecution>();
  const scheduled: string[] = [];
  const completed: string[] = [];
  const storage: WorkflowStorageApi = {
    getExecution: async () => structuredClone(current),
    markRunning: async () => {},
    recordStep: async (_scopeId, step) => {
      stepDocs.set(step.id, step);
    },
    updateExecution: async (_scopeId, partial) => {
      current = { ...current, ...partial };
    },
    getCancelState: async () => null,
    upsertSteps: async (_scopeId, steps) => {
      for (const step of steps) {
        if (step.id) {
          const previous = stepDocs.get(step.id);
          stepDocs.set(step.id, { ...previous, ...step } as EsWorkflowStepExecution);
        }
      }
    },
    getSteps: async (_scopeId, ids, sourceIncludes, sourceExcludes) => {
      return ids.flatMap((id) => {
        const step = stepDocs.get(id);
        if (!step) return [];
        return [project(step, sourceIncludes, sourceExcludes)];
      });
    },
    scheduleResume: async (_scopeId, _workflowRunId, _spaceId, resumeAt) => {
      scheduled.push(resumeAt);
      return { taskId: 'resume-1' };
    },
    executeConnector: async () => undefined,
    complete: async (_scopeId, update) => {
      completed.push(update.status);
      current = { ...current, status: update.status };
    },
    whereAmI: () => ({ threadId: 0, isMainThread: true }),
  };
  return {
    storage,
    scheduled,
    completed,
    dependencyPlan: {
      definitionHash: workflowDefinitionHash(initial.workflowDefinition),
      nodes: {},
      loops: {},
    },
  };
}

function project(
  step: EsWorkflowStepExecution,
  sourceIncludes?: string[],
  sourceExcludes?: string[]
): EsWorkflowStepExecution {
  const record = { ...step } as Record<string, unknown>;
  if (sourceExcludes) {
    for (const field of sourceExcludes) {
      delete record[field];
    }
  }
  if (sourceIncludes) {
    const picked: Record<string, unknown> = {};
    for (const field of sourceIncludes) {
      if (field in record) picked[field] = record[field];
    }
    return picked as unknown as EsWorkflowStepExecution;
  }
  return record as unknown as EsWorkflowStepExecution;
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  type EsWorkflowExecution,
  type EsWorkflowStepExecution,
  ExecutionStatus,
} from '@kbn/workflows';
import type {
  WorkflowDataPlaneApi,
  WorkflowLogApi,
  WorkflowStepCatalogApi,
  WorkflowStorageApi,
} from './tokens';
import { WorkflowExecutor } from './workflow_executor';

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
      scopeId: 'scope-1',
      workflowRunId: 'run-1',
      spaceId: 'default',
    });

    expect(parked.status).toBe(ExecutionStatus.WAITING);
    expect(store.scheduled).toHaveLength(1);
    expect(caseTitles).toEqual([]);

    const continued = await executor.run({
      scopeId: 'scope-2',
      workflowRunId: 'run-1',
      spaceId: 'default',
    });

    expect(continued.status).toBe(ExecutionStatus.COMPLETED);
    expect(caseTitles).toEqual(['Graph nodes 2']);
  });

  it('rejects a parallel step before the run starts', async () => {
    const store = createStore(
      execution([{ name: 'branches', type: 'parallel', branches: [{ steps: [] }] }])
    );
    const steps = catalog([]);
    const executor = new WorkflowExecutor(steps, store.storage, log());

    await expect(
      executor.run({ scopeId: 'scope-1', workflowRunId: 'run-1', spaceId: 'default' })
    ).rejects.toThrow(/Unsupported remote step type "parallel"/);
    expect(steps.run).not.toHaveBeenCalled();
  });

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
      executor.run({ scopeId: 'scope-1', workflowRunId: 'run-1', spaceId: 'default' })
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
      executor.run({ scopeId: 'scope', workflowRunId: 'run-1', spaceId: 'default' })
    ).rejects.toThrow('Unsupported remote step type "missing"');
    expect(steps.run).not.toHaveBeenCalled();
    expect(store.completed).toEqual([ExecutionStatus.FAILED]);
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
      executor.run({ scopeId: 'scope', workflowRunId: 'run-1', spaceId: 'default' })
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
  return { storage, scheduled, completed };
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

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { DataSetStep, WorkflowYaml } from '@kbn/workflows';
import { WorkflowGraph } from '@kbn/workflows/graph';
import {
  prepareStepDependencyPlan,
  sourceStepDependencyAnalyzer,
} from './prepare_step_dependency_plan';
import {
  createPlannedStepDependencyAnalyzer,
  workflowDefinitionHash,
} from '../workflow_context_manager/step_dependency_plan';

const dataStep = (name: string, value: string | number): DataSetStep => ({
  name,
  type: 'data.set',
  with: { value },
});

const definition = (name: string): WorkflowYaml => ({
  name,
  version: '1',
  enabled: true,
  triggers: [{ type: 'manual' }],
  steps: [
    { name: 'source', type: 'data.set', with: { items: ['a', 'b'] } },
    {
      name: 'loop',
      type: 'foreach',
      foreach: '{{ steps.source.output.items }}',
      steps: [dataStep('inside', '{{ steps.source.output.items }}')],
    },
    {
      name: 'condition',
      type: 'if',
      condition: 'steps.source.output.ok: true',
      steps: [dataStep('dynamic', '{{ steps[variables.key].output }}')],
    },
    {
      name: 'while_loop',
      type: 'while',
      condition: 'steps.source.output.again: true',
      steps: [dataStep('tick', 1)],
    },
  ],
});

describe('prepareStepDependencyPlan', () => {
  it('preserves definition analysis for every compiled node after a JSON roundtrip', () => {
    const workflow = definition('dependency-equivalence');
    const graph = WorkflowGraph.fromWorkflowDefinition(workflow);
    const { plan } = prepareStepDependencyPlan(workflow, graph);
    const analyzer = createPlannedStepDependencyAnalyzer(JSON.parse(JSON.stringify(plan)));
    for (const node of graph.getAllNodes()) {
      expect(analyzer.forNode(node)).toEqual(sourceStepDependencyAnalyzer.forNode(node));
    }
    expect(plan.loops.loop).toContain('source');
    expect(plan.loops.while_loop).toContain('source');
    expect(plan.nodes.dynamic).toBeNull();
    expect(analyzer.forLoopSource('loop', ['runtime', 'values'], 'foreach')).toEqual(
      new Set(['source'])
    );
    expect(analyzer.forLoopSource('unknown', null, 'condition')).toBeNull();
    expect(
      analyzer.forNode({
        id: 'synthetic',
        type: 'enter-test',
        stepId: 'test',
        stepType: 'test',
        isSynthetic: true,
      })
    ).toEqual(new Set());
  });

  it('caches only the immutable definition and invalidates edits', () => {
    const workflow = definition('dependency-cache');
    const graph = WorkflowGraph.fromWorkflowDefinition(workflow);
    const first = prepareStepDependencyPlan(workflow, graph);
    expect(first.cached).toBe(false);
    const second = prepareStepDependencyPlan(structuredClone(workflow), graph);
    expect(second.cached).toBe(true);
    expect(second.plan).toBe(first.plan);
    const edited = { ...workflow, description: 'new definition version' };
    const changed = prepareStepDependencyPlan(edited, WorkflowGraph.fromWorkflowDefinition(edited));
    expect(changed.cached).toBe(false);
    expect(changed.plan.definitionHash).not.toBe(first.plan.definitionHash);
    expect(changed.plan.definitionHash).toBe(workflowDefinitionHash(edited));
  });

  it('builds the immutable graph only on a cache miss and invalidates definition edits', () => {
    const workflow = definition('lazy-compiled-graph');
    const build = jest.fn(() => WorkflowGraph.fromWorkflowDefinition(workflow));
    const first = prepareStepDependencyPlan(workflow, build);
    const second = prepareStepDependencyPlan(structuredClone(workflow), build);
    expect(build).toHaveBeenCalledTimes(1);
    expect(second.graph).toBe(first.graph);
    expect(second.plan).toBe(first.plan);
    const edited = { ...workflow, description: 'changed' };
    const next = prepareStepDependencyPlan(edited, () =>
      WorkflowGraph.fromWorkflowDefinition(edited)
    );
    expect(next.cached).toBe(false);
    expect(next.graph).not.toBe(first.graph);
  });

  it('does not ship literal input payloads or templates in the plan', () => {
    const workflow = definition('dependency-payload');
    workflow.steps.push({
      name: 'large',
      type: 'data.set',
      with: { baggage: 'x'.repeat(128 * 1024) },
    });
    const { plan } = prepareStepDependencyPlan(
      workflow,
      WorkflowGraph.fromWorkflowDefinition(workflow)
    );
    expect(Buffer.byteLength(JSON.stringify(plan))).toBeLessThan(4096);
    expect(JSON.stringify(plan)).not.toContain('baggage');
    expect(JSON.stringify(plan)).not.toContain('{{');
  });
});

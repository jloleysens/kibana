/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { EsWorkflowExecution } from '@kbn/workflows';
import { extractPropertyPathsFromKql, scanForTemplateVariables } from '@kbn/workflows/common/utils';
import { isEnterForeach, isEnterWhile, type WorkflowGraph } from '@kbn/workflows/graph';
import {
  extractReferencedStepIds,
  extractReferencedStepIdsFromVariables,
} from '../workflow_context_manager/extract_referenced_step_ids';
import {
  type StepDependencyAnalyzer,
  type StepDependencyPlan,
  workflowDefinitionHash,
} from '../workflow_context_manager/step_dependency_plan';

export const sourceStepDependencyAnalyzer: StepDependencyAnalyzer = {
  forNode: extractReferencedStepIds,
  forLoopSource: (_stepId, value, kind) => {
    try {
      const variables =
        kind === 'condition' && typeof value === 'string'
          ? extractPropertyPathsFromKql(value)
          : scanForTemplateVariables(value);
      return extractReferencedStepIdsFromVariables(variables);
    } catch {
      return null;
    }
  },
};

const plans = new Map<string, { plan: StepDependencyPlan; graph: WorkflowGraph }>();
const MAX_CACHED_DEFINITIONS = 64;

/** Memoizes definition-only IO dependencies on the coordinator; no run inputs or outputs are cached. */
export const prepareStepDependencyPlan = (
  definition: EsWorkflowExecution['workflowDefinition'],
  graphOrBuild: WorkflowGraph | (() => WorkflowGraph)
): { plan: StepDependencyPlan; graph: WorkflowGraph; cached: boolean } => {
  const definitionHash = workflowDefinitionHash(definition);
  const existing = plans.get(definitionHash);
  if (existing) {
    plans.delete(definitionHash);
    plans.set(definitionHash, existing);
    return { ...existing, cached: true };
  }
  const graph = typeof graphOrBuild === 'function' ? graphOrBuild() : graphOrBuild;
  const nodes = new Map<string, readonly string[] | null>();
  const loops = new Map<string, readonly string[] | null>();
  for (const id of graph.topologicalOrder) {
    const node = graph.getNode(id);
    if (node) {
      const refs = sourceStepDependencyAnalyzer.forNode(node);
      nodes.set(id, refs === null ? null : [...refs]);
      if (isEnterForeach(node) || isEnterWhile(node)) {
        const value = isEnterForeach(node)
          ? node.configuration.foreach
          : node.configuration.condition;
        const condition = sourceStepDependencyAnalyzer.forLoopSource(
          node.stepId,
          value,
          'condition'
        );
        const foreach = sourceStepDependencyAnalyzer.forLoopSource(node.stepId, value, 'foreach');
        loops.set(
          node.stepId,
          condition === null || foreach === null ? null : [...new Set([...condition, ...foreach])]
        );
      }
    }
  }
  const plan: StepDependencyPlan = {
    definitionHash,
    nodes: Object.fromEntries(nodes),
    loops: Object.fromEntries(loops),
  };
  plans.set(definitionHash, { plan, graph });
  if (plans.size > MAX_CACHED_DEFINITIONS) {
    const oldest = plans.keys().next().value;
    if (oldest !== undefined) plans.delete(oldest);
  }
  return { plan, graph, cached: false };
};

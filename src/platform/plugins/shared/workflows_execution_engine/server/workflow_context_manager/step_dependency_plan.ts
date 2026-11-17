/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { createHash } from 'node:crypto';
import type { EsWorkflowExecution } from '@kbn/workflows';
import type { GraphNodeUnion } from '@kbn/workflows/graph';

export interface StepDependencyPlan {
  readonly definitionHash: string;
  readonly nodes: Readonly<Record<string, readonly string[] | null>>;
  readonly loops: Readonly<Record<string, readonly string[] | null>>;
}

export interface StepDependencyAnalyzer {
  forNode(node: GraphNodeUnion): ReadonlySet<string> | null;
  forLoopSource(
    stepId: string,
    value: unknown,
    kind: 'foreach' | 'condition'
  ): ReadonlySet<string> | null;
}

export const workflowDefinitionHash = (
  definition: EsWorkflowExecution['workflowDefinition']
): string =>
  createHash('sha256')
    .update(JSON.stringify(definition) ?? 'null')
    .digest('hex');

/** Binds plain definition-time dependency data without loading template or KQL analysis code. */
export const createPlannedStepDependencyAnalyzer = (
  plan: StepDependencyPlan
): StepDependencyAnalyzer => {
  const asSets = (entries: StepDependencyPlan['nodes']) =>
    new Map(
      Object.entries(entries).map(
        ([key, value]) => [key, value === null ? null : new Set(value)] as const
      )
    );
  const nodes = asSets(plan.nodes);
  const loops = asSets(plan.loops);
  return {
    forNode: (node) =>
      'isSynthetic' in node && node.isSynthetic ? new Set() : nodes.get(node.id) ?? null,
    forLoopSource: (stepId) => loops.get(stepId) ?? null,
  };
};

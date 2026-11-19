/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { createToken } from '@kbn/core-di';
import type { StepHandlerContext } from '../step_registry/types';

export interface RemoteStepContext {
  /** Executor-local only; this context is never serialized across the RPC seam. */
  readonly handlerContext?: StepHandlerContext;
  readonly signal?: AbortSignal;
  readonly attribution?: {
    readonly type: string;
    readonly id: string;
    readonly name: string;
    readonly runId: string;
  };
}

export interface RemoteWorkflowStep {
  run(scopeId: string, input: unknown, context: RemoteStepContext): Promise<unknown>;
}

/** Contribution kind owned by Workflows Extensions. Producers contribute step classes of this kind. */
export const WorkflowStep = createToken<RemoteWorkflowStep>('workflows.step');
export const WorkflowConnector = createToken<RemoteWorkflowStep>('workflows.connector');

export const WorkflowStepCatalogToken =
  createToken<WorkflowStepCatalogApi>('workflows.stepCatalog');

export interface WorkflowStepCatalogApi {
  supports(stepType: string): boolean;
  supportsConnector(connectorType: string): boolean;
  runConnector(
    connectorType: string,
    scopeId: string,
    input: unknown,
    context: RemoteStepContext
  ): Promise<unknown>;
  run(
    stepType: string,
    scopeId: string,
    input: unknown,
    context: RemoteStepContext
  ): Promise<unknown>;
}

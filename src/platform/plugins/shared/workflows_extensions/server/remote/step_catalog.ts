/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { recordRemoteHeap, recordRemoteTiming } from '@kbn/core-remote-common';
import type { RemoteStepContext, RemoteWorkflowStep } from './tokens';

type StepFactory = () => RemoteWorkflowStep;

/**
 * Executor-local catalogue. The host constructs one per worker with the contributed step factories.
 * Unknown step types fail here; they are not executed on the coordinator.
 */
export class WorkflowStepCatalog {
  constructor(
    private readonly steps: ReadonlyMap<string, StepFactory>,
    private readonly kinds: ReadonlyMap<string, string> = new Map()
  ) {}

  supports(stepType: string): boolean {
    return this.steps.has(stepType) && this.kind(stepType) === 'workflows.step';
  }

  supportsConnector(connectorType: string): boolean {
    return this.steps.has(connectorType) && this.kind(connectorType) === 'workflows.connector';
  }

  async runConnector(
    connectorType: string,
    scopeId: string,
    input: unknown,
    context: RemoteStepContext
  ): Promise<unknown> {
    if (!this.supportsConnector(connectorType)) {
      throw new Error(`Unsupported remote connector type "${connectorType}"`);
    }
    return this.invoke(connectorType, scopeId, input, context);
  }

  private kind(stepType: string): string {
    return this.kinds.get(stepType) ?? 'workflows.step';
  }

  async run(
    stepType: string,
    scopeId: string,
    input: unknown,
    context: RemoteStepContext
  ): Promise<unknown> {
    if (!this.supports(stepType)) {
      throw new Error(`Unsupported remote step type "${stepType}"`);
    }
    const started = performance.now();
    recordRemoteHeap('EXTENSION_HANDLER_BEFORE', stepType);
    recordRemoteTiming('extension_handler', {
      scopeId,
      stepType,
      executionId: context.handlerContext?.contextManager.getContext().execution.id,
    });
    try {
      return await this.invoke(stepType, scopeId, input, context);
    } finally {
      recordRemoteHeap('EXTENSION_HANDLER_AFTER', stepType);
      recordRemoteTiming('extension_handler_complete', {
        scopeId,
        stepType,
        durationMs: performance.now() - started,
      });
    }
  }

  private async invoke(
    stepType: string,
    scopeId: string,
    input: unknown,
    context: RemoteStepContext
  ): Promise<unknown> {
    const create = this.steps.get(stepType);
    if (!create) {
      throw new Error(
        `Unsupported remote step type "${stepType}". Experimental remote execution only runs steps registered for this anchor.`
      );
    }
    return create().run(scopeId, input, context);
  }
}

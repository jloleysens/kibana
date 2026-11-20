/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { inject } from 'inversify';
import { isMainThread, threadId } from 'node:worker_threads';
import { remotable } from '@kbn/core-remote-common';
import {
  type WorkflowControlApi,
  WorkflowControlToken,
  type WorkflowDataPlaneApi,
  WorkflowDataPlaneToken,
  type WorkflowStorageApi,
  type WorkflowThreadIdentity,
} from './tokens';

/** Imports repository persistence only on first access, using the current dispatch's clients. */
@remotable()
export class ExecutorStorage implements WorkflowStorageApi {
  private coordinatorPersistence?: Promise<WorkflowStorageApi | null>;
  constructor(
    @inject(WorkflowDataPlaneToken) private readonly data: WorkflowDataPlaneApi,
    @inject(WorkflowControlToken) private readonly control: WorkflowControlApi
  ) {}

  whereAmI(): WorkflowThreadIdentity {
    return { threadId, isMainThread };
  }

  async getExecution(
    ...args: Parameters<WorkflowStorageApi['getExecution']>
  ): ReturnType<WorkflowStorageApi['getExecution']> {
    const storage = await this.persistence(args[0]);
    return storage.getExecution(...args);
  }

  async markRunning(
    ...args: Parameters<WorkflowStorageApi['markRunning']>
  ): ReturnType<WorkflowStorageApi['markRunning']> {
    const storage = await this.persistence(args[0]);
    return storage.markRunning(...args);
  }

  async recordStep(
    ...args: Parameters<WorkflowStorageApi['recordStep']>
  ): ReturnType<WorkflowStorageApi['recordStep']> {
    const storage = await this.persistence(args[0]);
    return storage.recordStep(...args);
  }

  async updateExecution(
    ...args: Parameters<WorkflowStorageApi['updateExecution']>
  ): ReturnType<WorkflowStorageApi['updateExecution']> {
    const storage = await this.persistence(args[0]);
    return storage.updateExecution(...args);
  }

  async getCancelState(
    ...args: Parameters<WorkflowStorageApi['getCancelState']>
  ): ReturnType<WorkflowStorageApi['getCancelState']> {
    const storage = await this.persistence(args[0]);
    return storage.getCancelState(...args);
  }

  async upsertSteps(
    ...args: Parameters<WorkflowStorageApi['upsertSteps']>
  ): ReturnType<WorkflowStorageApi['upsertSteps']> {
    const storage = await this.persistence(args[0]);
    return storage.upsertSteps(...args);
  }

  async getSteps(
    ...args: Parameters<WorkflowStorageApi['getSteps']>
  ): ReturnType<WorkflowStorageApi['getSteps']> {
    const storage = await this.persistence(args[0]);
    return storage.getSteps(...args);
  }

  async complete(
    ...args: Parameters<WorkflowStorageApi['complete']>
  ): ReturnType<WorkflowStorageApi['complete']> {
    const storage = await this.persistence(args[0]);
    return storage.complete(...args);
  }

  async scheduleResume(
    ...args: Parameters<WorkflowStorageApi['scheduleResume']>
  ): ReturnType<WorkflowStorageApi['scheduleResume']> {
    return this.control.scheduleResume(...args);
  }

  async executeConnector(
    ...args: Parameters<WorkflowStorageApi['executeConnector']>
  ): ReturnType<WorkflowStorageApi['executeConnector']> {
    return this.control.executeConnector(...args);
  }

  private async persistence(scopeId: string): Promise<WorkflowStorageApi> {
    this.coordinatorPersistence ??= this.control.persistence();
    const coordinator = await this.coordinatorPersistence;
    if (coordinator) return coordinator;
    const { createExecutorPersistence } = await import('./executor_persistence');
    return createExecutorPersistence(this.data.internal(scopeId), this.control);
  }
}

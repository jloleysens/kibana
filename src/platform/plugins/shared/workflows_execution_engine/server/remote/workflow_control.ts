/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { remotable } from '@kbn/core-remote-common';
import type { WorkflowControlApi } from './tokens';

/** Keeps scheduling, connector egress and tenant diagnostics in Kibana. */
@remotable()
export class WorkflowControl implements WorkflowControlApi {
  constructor(private readonly callbacks: WorkflowControlApi) {}

  async persistence(): ReturnType<WorkflowControlApi['persistence']> {
    return this.callbacks.persistence();
  }

  async scheduleResume(
    ...args: Parameters<WorkflowControlApi['scheduleResume']>
  ): Promise<{ taskId: string }> {
    return this.callbacks.scheduleResume(...args);
  }

  async executeConnector(
    ...args: Parameters<WorkflowControlApi['executeConnector']>
  ): ReturnType<WorkflowControlApi['executeConnector']> {
    return this.callbacks.executeConnector(...args);
  }

  async initializeLogs(): Promise<void> {
    await this.callbacks.initializeLogs();
  }

  async info(message: string): Promise<void> {
    await this.callbacks.info(message);
  }
}

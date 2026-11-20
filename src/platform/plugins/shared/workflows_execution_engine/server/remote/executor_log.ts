/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { inject } from 'inversify';
import { remotable } from '@kbn/core-remote-common';
import {
  type WorkflowControlApi,
  WorkflowControlToken,
  type WorkflowDataPlaneApi,
  WorkflowDataPlaneToken,
  type WorkflowLogApi,
} from './tokens';
import type { WorkflowLogEvent } from '../repositories/logs_repository/data_stream';
import type { LogsRepository } from '../repositories/logs_repository/logs_repository';

/** Persists execution events directly; tenant diagnostics stay on the coordinator, not fleet stdout. */
@remotable()
export class ExecutorLog implements WorkflowLogApi {
  private repository: Promise<Pick<LogsRepository, 'createLogs'>> | undefined;
  constructor(
    @inject(WorkflowDataPlaneToken) private readonly data: WorkflowDataPlaneApi,
    @inject(WorkflowControlToken) private readonly control: WorkflowControlApi
  ) {}

  async info(message: string): Promise<void> {
    await this.control.info(message);
  }

  async write(events: readonly object[]): Promise<void> {
    if (events.length === 0) return;
    this.repository ??= this.control
      .initializeLogs()
      .then(async () => {
        const { createExecutorLogsRepository } = await import('./executor_logs_repository');
        return createExecutorLogsRepository(this.data.internal());
      })
      .catch((error: Error) => {
        this.repository = undefined;
        throw error;
      });
    try {
      const repository = await this.repository;
      await repository.createLogs(events as WorkflowLogEvent[]);
    } catch (error) {
      // The original queue owns degradation; never forward tenant payloads or raw ES errors.
      await Promise.resolve(
        this.control.info('Executor log persistence failed after retries')
      ).catch(() => {});
      throw error;
    }
  }
}

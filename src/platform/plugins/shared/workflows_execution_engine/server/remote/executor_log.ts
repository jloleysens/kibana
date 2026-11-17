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
import { WORKFLOWS_EXECUTION_LOGS_DATA_STREAM } from '../repositories/logs_repository/constants';

/** Persists execution events directly; tenant diagnostics stay on the coordinator, not fleet stdout. */
@remotable()
export class ExecutorLog implements WorkflowLogApi {
  private initialized: Promise<void> | undefined;
  constructor(
    @inject(WorkflowDataPlaneToken) private readonly data: WorkflowDataPlaneApi,
    @inject(WorkflowControlToken) private readonly control: WorkflowControlApi
  ) {}

  async info(message: string): Promise<void> {
    await this.control.info(message);
  }

  async write(events: readonly object[]): Promise<void> {
    if (events.length === 0) return;
    this.initialized ??= this.control.initializeLogs().catch((error: Error) => {
      this.initialized = undefined;
      throw error;
    });
    await this.initialized;
    const result = await this.data.internal().bulk({
      operations: events.flatMap((event) => [
        { create: { _index: WORKFLOWS_EXECUTION_LOGS_DATA_STREAM } },
        event,
      ]),
    });
    if (result.errors) {
      await this.control.info('Executor log bulk write failed');
      throw new Error('Executor log bulk write failed');
    }
  }
}

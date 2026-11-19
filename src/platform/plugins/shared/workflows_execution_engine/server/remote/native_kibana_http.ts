/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { HttpSelfRunCredential } from '@kbn/core-http-server';
import { recordRemoteHeap, recordRemoteTiming } from '@kbn/core-remote-common';
import type { KibanaRequestDefinition } from '@kbn/workflows';
import type { WorkflowHttpApi, WorkflowKibanaDispatch } from './tokens';
import type { CallKibanaApiParams, CallKibanaApiResult } from '../lib/call_kibana_api';
import type { StepExecutionRuntime } from '../workflow_context_manager/step_execution_runtime';
import type { WorkflowExecutionRuntimeManager } from '../workflow_context_manager/workflow_execution_runtime_manager';

type Implementation = typeof import('./native_kibana_http_impl');
let implementation: Promise<Implementation> | undefined;

/** Keeps Core HTTP and the original Kibana handler out of the idle executor's loaded set. */
export class NativeKibanaHttp {
  private pending?: Promise<Awaited<ReturnType<Implementation['createNativeKibanaHttp']>>>;
  private closed = false;

  constructor(
    private dispatch: WorkflowKibanaDispatch | undefined,
    private readonly spaceId: string,
    private readonly executionId: string,
    private readonly http?: WorkflowHttpApi,
    private readonly refreshRunCredential?: () => Promise<HttpSelfRunCredential | null>
  ) {}

  async call<T = unknown>(params: CallKibanaApiParams): Promise<CallKibanaApiResult<T>> {
    return (await this.get(this.executionId)).call<T>(params);
  }

  node(
    runtime: StepExecutionRuntime,
    workflowRuntime: WorkflowExecutionRuntimeManager,
    definition?: KibanaRequestDefinition
  ) {
    return {
      run: async () => {
        runtime.abortController.signal.throwIfAborted();
        const services = await this.get(runtime.workflowExecution.id);
        recordRemoteTiming('kibana_handler', {
          executionId: runtime.workflowExecution.id,
          stepType: runtime.node.stepType,
          stepId: runtime.node.stepId,
        });
        const started = performance.now();
        recordRemoteHeap('KIBANA_HANDLER_BEFORE', runtime.node.stepType);
        await services.node(runtime, workflowRuntime, definition ?? null).run();
        recordRemoteHeap('KIBANA_HANDLER_AFTER', runtime.node.stepType);
        recordRemoteTiming('kibana_handler_complete', {
          executionId: runtime.workflowExecution.id,
          stepType: runtime.node.stepType,
          stepId: runtime.node.stepId,
          durationMs: performance.now() - started,
        });
      },
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.dispatch = undefined;
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      const [result] = await Promise.allSettled([pending]);
      if (result.status === 'fulfilled') await result.value.close();
    }
  }

  private async get(executionId: string) {
    if (this.closed) throw new Error('Kibana HTTP lease is closed');
    if (!this.pending) {
      const dispatch = this.dispatch;
      const http = this.http;
      if (!http) throw new Error('Native Kibana HTTP requires a worker transport provider');
      if (!dispatch) throw new Error('Native Kibana HTTP requires a dispatch identity and policy');
      const cached = implementation !== undefined;
      recordRemoteHeap('KIBANA_HTTP_BEFORE', executionId);
      const started = performance.now();
      implementation ??= import('./native_kibana_http_impl').catch((error) => {
        implementation = undefined;
        throw error;
      });
      this.pending = implementation
        .then(async ({ createNativeKibanaHttp }) => {
          if (this.closed) throw new Error('Kibana HTTP lease is closed');
          const services = await createNativeKibanaHttp(
            dispatch,
            this.spaceId,
            this.executionId,
            http,
            this.refreshRunCredential
          );
          if (this.closed) {
            await services.close();
            throw new Error('Kibana HTTP lease is closed');
          }
          recordRemoteHeap('KIBANA_HTTP_AFTER', executionId);
          recordRemoteTiming('kibana_http_first_use', {
            executionId,
            cached,
            durationMs: performance.now() - started,
          });
          return services;
        })
        .catch((error) => {
          this.pending = undefined;
          throw error;
        });
    }
    return this.pending;
  }
}

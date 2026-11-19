/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { RemoteModule } from '@kbn/core-remote-common';
import {
  WorkflowChildToken,
  WorkflowControlToken,
  WorkflowCredentialsToken,
  WorkflowDataPlaneToken,
  WorkflowExecutorToken,
  WorkflowHttpToken,
  WorkflowLogToken,
  WorkflowStepRunnerToken,
  WorkflowStorageToken,
} from './tokens';

export {
  WorkflowExecutorToken,
  WorkflowLogToken,
  WorkflowStorageToken,
  WorkflowStepRunnerToken,
  WorkflowDataPlaneToken,
  WorkflowControlToken,
} from './tokens';
export type { WorkflowExecutorApi, WorkflowLogApi, WorkflowStorageApi } from './tokens';

export const remoteModule: RemoteModule = {
  providers: [
    {
      token: WorkflowCredentialsToken,
      placement: 'coordinator',
      modulePath: require.resolve('./workflow_credentials'),
      exportName: 'WorkflowCredentials',
    },
    {
      token: WorkflowHttpToken,
      placement: 'executor',
      modulePath: require.resolve('@kbn/core-http-server-internal/src/worker_http_provider'),
      exportName: 'WorkerHttpProvider',
    },
    {
      token: WorkflowChildToken,
      placement: 'coordinator',
      modulePath: require.resolve('./native_child_api'),
      exportName: 'NativeChildApi',
    },
    {
      token: WorkflowStepRunnerToken,
      placement: 'coordinator',
      modulePath: require.resolve('./workflow_step_runner'),
      exportName: 'WorkflowStepRunner',
    },
    {
      token: WorkflowDataPlaneToken,
      placement: 'executor',
      modulePath: require.resolve('./executor_data_plane'),
      exportName: 'ExecutorDataPlane',
    },
    {
      token: WorkflowControlToken,
      placement: 'coordinator',
      modulePath: require.resolve('./workflow_control'),
      exportName: 'WorkflowControl',
    },
    {
      token: WorkflowExecutorToken,
      placement: 'executor',
      role: 'root',
      modulePath: require.resolve('./workflow_executor'),
      exportName: 'WorkflowExecutor',
    },
    {
      token: WorkflowStorageToken,
      placement: 'executor',
      modulePath: require.resolve('./executor_storage'),
      exportName: 'ExecutorStorage',
    },
    {
      token: WorkflowLogToken,
      placement: 'executor',
      modulePath: require.resolve('./executor_log'),
      exportName: 'ExecutorLog',
    },
  ],
};

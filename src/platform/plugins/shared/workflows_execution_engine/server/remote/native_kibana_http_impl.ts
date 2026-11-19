/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { kibanaRequestFactory } from '@kbn/core-http-server-utils';
import { asSpaceId } from '@kbn/core-spaces-common';
import type { KibanaGraphNode } from '@kbn/workflows/graph/types';
import { noopLogger } from './noop_logger';
import type { WorkflowHttpApi, WorkflowKibanaDispatch } from './tokens';
import { callKibanaApi } from '../lib/call_kibana_api';
import { KibanaActionStepImpl } from '../step/kibana_action_step';
import type { StepExecutionRuntime } from '../workflow_context_manager/step_execution_runtime';
import type { WorkflowExecutionRuntimeManager } from '../workflow_context_manager/workflow_execution_runtime_manager';

/** Binds Core's original scoped transport and original handler to a single run identity. */
export const createNativeKibanaHttp = async (
  dispatch: WorkflowKibanaDispatch,
  spaceId: string,
  provider: WorkflowHttpApi
) => {
  const http = await provider.create(dispatch.config, noopLogger(), dispatch);
  const fakeRequest = kibanaRequestFactory({
    path: '/',
    headers: {
      ...dispatch.eventChainHeaders,
      authorization: dispatch.authorization,
      'x-elastic-internal-origin': 'Kibana',
    },
    spaceId: asSpaceId(spaceId),
  });
  return {
    node: (runtime: StepExecutionRuntime, workflowRuntime: WorkflowExecutionRuntimeManager) =>
      new KibanaActionStepImpl(
        runtime.node as KibanaGraphNode,
        runtime,
        workflowRuntime,
        runtime.stepLogger,
        (params) =>
          callKibanaApi(
            {
              fakeRequest,
              coreStart: { http },
              spaceId,
              workflowRunId: runtime.workflowExecution.id,
            },
            params
          )
      ),
    close: () => http.selfClient.close(),
  };
};

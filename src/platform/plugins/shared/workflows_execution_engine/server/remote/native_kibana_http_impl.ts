/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { HttpSelfRunCredential } from '@kbn/core-http-server';
import { kibanaRequestFactory } from '@kbn/core-http-server-utils';
import { asSpaceId } from '@kbn/core-spaces-common';
import type { KibanaRequestDefinition } from '@kbn/workflows';
import type { KibanaGraphNode } from '@kbn/workflows/graph/types';
import { noopLogger } from './noop_logger';
import type { WorkflowHttpApi, WorkflowKibanaDispatch } from './tokens';
import { callKibanaApi, type CallKibanaApiParams } from '../lib/call_kibana_api';
import { KibanaActionStepImpl } from '../step/kibana_action_step';
import type { StepExecutionRuntime } from '../workflow_context_manager/step_execution_runtime';
import type { WorkflowExecutionRuntimeManager } from '../workflow_context_manager/workflow_execution_runtime_manager';

/** Binds Core's original scoped transport and original handler to a single run identity. */
export const createNativeKibanaHttp = async (
  dispatch: WorkflowKibanaDispatch,
  spaceId: string,
  workflowRunId: string,
  provider: WorkflowHttpApi,
  refreshRunCredential?: () => Promise<HttpSelfRunCredential | null>
) => {
  const http = await provider.create(dispatch.config, noopLogger(), dispatch, refreshRunCredential);
  const fakeRequest = kibanaRequestFactory({
    path: '/',
    headers: {
      ...dispatch.eventChainHeaders,
      authorization: dispatch.authorization,
      'x-elastic-internal-origin': 'Kibana',
    },
    spaceId: asSpaceId(spaceId),
  });
  const call = <T = unknown>(params: CallKibanaApiParams) =>
    callKibanaApi<T>({ fakeRequest, coreStart: { http }, spaceId, workflowRunId }, params);
  return {
    call,
    node: (
      runtime: StepExecutionRuntime,
      workflowRuntime: WorkflowExecutionRuntimeManager,
      definition: KibanaRequestDefinition | null
    ) =>
      new KibanaActionStepImpl(
        runtime.node as KibanaGraphNode,
        runtime,
        workflowRuntime,
        runtime.stepLogger,
        call,
        definition
      ),
    close: () => http.selfClient.close(),
  };
};

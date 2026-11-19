/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { CoreStart, KibanaRequest, Logger } from '@kbn/core/server';
import { recordRemoteHeap, recordRemoteTiming, recordSeam } from '@kbn/core-remote-common';
import type { RemoteSetup } from '@kbn/core-remote-server';
import { UIAM_INTERNAL_CALLER_ATTESTATION_HEADER } from '@kbn/core-security-server';
import { visitNestedSteps } from '@kbn/workflows';
import type { WorkflowDispatchFacts, WorkflowExecutorApi, WorkflowRunOutcome } from './tokens';
import { workflowDispatchCredentials } from './workflow_dispatch_credentials';
import { getInternalUiamCallerAttestationHeaders } from '../lib/get_internal_uiam_caller_attestation_headers';
import type { StepExecutionRepository } from '../repositories/step_execution_repository';
import type { WorkflowExecutionRepository } from '../repositories/workflow_execution_repository';
import { resolveStepOutputLimit } from '../step/resolve_step_output_limit';
import { getOutboundEventChainHeaders } from '../trigger_events/event_context/event_chain_context';
import type { StepDependencyPlan } from '../workflow_context_manager/step_dependency_plan';
import { isWorkflowTaskManagerAbortSignal } from '../workflow_task_shutdown';

/** Dispatches under an exclusive warm-host lease using the identity approved by shared guards. */
export const dispatchWorkflow = async ({
  remote,
  coreStart,
  request,
  signal,
  workflowRunId,
  spaceId,
  facts,
  dependencyPlan,
  repositories,
  logger,
  phase,
}: {
  remote: RemoteSetup;
  coreStart: CoreStart;
  repositories: {
    workflowExecutionRepository: Pick<WorkflowExecutionRepository, 'getWorkflowExecutionById'>;
    stepExecutionRepository: Pick<StepExecutionRepository, 'getStepExecutionsByWorkflowExecution'>;
  };
  request: KibanaRequest;
  signal: AbortSignal;
  workflowRunId: string;
  spaceId: string;
  facts: WorkflowDispatchFacts;
  dependencyPlan: StepDependencyPlan;
  logger: Logger;
  phase: 'run' | 'resume';
}): Promise<WorkflowRunOutcome> => {
  signal.throwIfAborted();
  recordRemoteTiming('lease_requested', { executionId: workflowRunId });
  const lease = await remote.lease<WorkflowExecutorApi>('workflows', {
    settingsKey: JSON.stringify(facts),
    signal,
  });
  recordRemoteTiming('lease_acquired', { executionId: workflowRunId });
  let scopeId: string | undefined;
  try {
    const execution = await repositories.workflowExecutionRepository.getWorkflowExecutionById(
      workflowRunId,
      spaceId
    );
    if (!execution || execution.spaceId !== spaceId)
      throw new Error('Workflow execution not found');
    const admittedChildren = new Set<string>();
    const steps = await repositories.stepExecutionRepository.getStepExecutionsByWorkflowExecution(
      workflowRunId,
      execution.stepExecutionIds
    );
    for (const step of steps) {
      const childId = step.state?.executionId;
      if (
        step.workflowRunId === workflowRunId &&
        step.spaceId === spaceId &&
        typeof childId === 'string'
      ) {
        const child = await repositories.workflowExecutionRepository.getWorkflowExecutionById(
          childId,
          spaceId
        );
        if (
          child?.context?.parentWorkflowExecutionId === workflowRunId &&
          child.spaceId === spaceId
        )
          admittedChildren.add(childId);
      }
    }
    const stepOutputLimits = new Map<string, number>();
    visitNestedSteps(
      [
        ...execution.workflowDefinition.steps,
        ...(execution.workflowDefinition.settings?.['on-failure']?.fallback ?? []),
      ],
      ({ step }) => {
        stepOutputLimits.set(
          step.name,
          resolveStepOutputLimit(
            step['max-step-size'],
            execution.workflowDefinition.settings?.['max-step-size'],
            () => facts.maxResponseSizeBytes
          )
        );
      }
    );
    scopeId = lease.openScope(
      request,
      {
        workflowRunId,
        spaceId,
        workflowId: execution.workflowId,
        workflowName: execution.workflowDefinition.name,
        admittedChildren,
      },
      stepOutputLimits
    );
    const activeScope = scopeId;
    const onAbort = () => {
      void lease.stub
        .cancel(activeScope, isWorkflowTaskManagerAbortSignal(signal) ? 'task_manager' : undefined)
        .catch(() => logger.warn('Remote workflow cancellation failed'));
    };
    recordRemoteTiming('dispatched', { executionId: workflowRunId, scopeId });
    const runRequest = {
      scopeId,
      workflowRunId,
      spaceId,
      credentials: workflowDispatchCredentials(request),
      kibana: {
        config: coreStart.http.selfClient.getDispatchConfig(),
        authorization: requireRunAuthorization(request),
        uiamAttestation: getInternalUiamCallerAttestationHeaders(coreStart, request)[
          UIAM_INTERNAL_CALLER_ATTESTATION_HEADER
        ],
        eventChainHeaders: getOutboundEventChainHeaders(request, workflowRunId),
      },
      facts,
      dependencyPlan,
    };
    recordSeam('WorkflowDependencyPlan', dependencyPlan);
    recordSeam('WorkflowExecutor.run.request', runRequest);
    const pending = lease.stub.run(runRequest);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    try {
      return await pending;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  } finally {
    if (scopeId) {
      lease.closeScope(scopeId);
    }
    await lease.release();
    recordRemoteHeap('MAIN_HEAP', `after-remote-${phase}`);
  }
};

const requireRunAuthorization = (request: KibanaRequest): string => {
  const { authorization } = request.headers;
  if (typeof authorization !== 'string')
    throw new Error('Worker Kibana HTTP requires run authorization');
  return authorization;
};

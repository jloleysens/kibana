/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import { recordRemoteHeap, recordRemoteTiming } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
type RemoteStepContext = Parameters<RemoteWorkflowStep['run']>[2];
import type { InferencePolicyApi } from '@kbn/inference-plugin/server/remote/tokens';
import type { InferenceWorkflowServices } from '../steps/ai/inference_workflow_services';
import type { InferenceFeaturesApi, InferenceDataPlane } from './tokens';

let implementation:
  | Promise<typeof import('@kbn/inference-plugin/server/remote/worker_inference')>
  | undefined;
const logger: Logger = {
  get: () => logger,
  log() {},
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  isLevelEnabled: () => false,
};

/** Only ES-endpoint-backed calls are admitted; other backings keep their existing placement. */
export const runInferenceStep = async ({
  scopeId,
  context,
  policyApi,
  featuresApi,
  data,
  runHandler,
}: {
  scopeId: string;
  context: RemoteStepContext;
  policyApi: InferencePolicyApi;
  featuresApi: InferenceFeaturesApi;
  data: InferenceDataPlane;
  runHandler: (services: InferenceWorkflowServices) => Promise<unknown>;
}): Promise<unknown> => {
  const handlerContext = context.handlerContext;
  if (!handlerContext) throw new Error('Native inference requires executor-local handler context');
  handlerContext.abortSignal.throwIfAborted();
  const fallback = () => {
    if (!context.runUncarvedHandler)
      throw new Error('Uncarved inference backing has no coordinator placement');
    recordRemoteTiming('inference_uncarved_backing', { scopeId });
    return context.runUncarvedHandler();
  };
  const policy = await policyApi.read(scopeId);
  if (!policy) return fallback();
  const features = await featuresApi.list(scopeId);
  const cached = implementation !== undefined;
  const started = performance.now();
  recordRemoteHeap('INFERENCE_SERVICE_BEFORE', scopeId);
  implementation ??= import('@kbn/inference-plugin/server/remote/worker_inference').catch(
    (error) => {
      implementation = undefined;
      throw error;
    }
  );
  const [{ createWorkerInference, UncarvedInferenceBacking }, { parseMaxStepSize }] =
    await Promise.all([implementation, import('../steps/ai/utils/parse_max_step_size')]);
  const inference = createWorkerInference({
    scopeId,
    policy,
    capability: policyApi,
    internalClient: data.internal(scopeId),
    userClient: data.user(scopeId),
    logger,
  });
  recordRemoteHeap('INFERENCE_SERVICE_AFTER', scopeId);
  recordRemoteTiming('inference_service_first_use', {
    scopeId,
    cached,
    durationMs: performance.now() - started,
  });
  handlerContext.abortSignal.throwIfAborted();
  try {
    const result = await runHandler({
      inference,
      parseMaxStepSize,
      searchInferenceEndpoints: {
        features: { get: (id) => features.find(({ featureId }) => id === featureId) },
        endpoints: {
          getForFeature: (id, _request, options) => featuresApi.getForFeature(scopeId, id, options),
        },
      },
    });
    recordRemoteTiming('inference_native_handler_complete', {
      scopeId,
      executionId: handlerContext.contextManager.getContext().execution.id,
    });
    return result;
  } catch (error) {
    if (error instanceof UncarvedInferenceBacking) return fallback();
    throw error;
  }
};

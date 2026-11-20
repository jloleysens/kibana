/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getConnectorProvider, getConnectorModel } from '@kbn/inference-common';
import type { InferenceConnector } from '@kbn/inference-common';
import type { ModelCallInfo } from '@kbn/agent-builder-server/runner';
import type { InferenceCompleteCallbackHandler } from '@kbn/inference-common/src/chat_complete';
import type { TrackingService } from '../../../telemetry/tracking_service';

/** Records a provider response using the original model fallback and usage tracker. */
export const recordModelCompletion = ({
  connectorId,
  connector,
  event,
  completedCalls,
  trackingService,
}: {
  connectorId: string;
  connector: InferenceConnector;
  event: Parameters<InferenceCompleteCallbackHandler>[0];
  completedCalls: ModelCallInfo[];
  trackingService?: Pick<TrackingService, 'trackLLMUsage'>;
}): void => {
  // Prefer model from provider response, fallback to connector-based model
  let modelName: string | undefined = event.model;
  if (!modelName && connector) {
    try {
      modelName = getConnectorModel(connector);
    } catch (e) {
      // ignore errors
    }
  }

  completedCalls.push({
    connectorId,
    tokens: event.tokens,
    model: modelName,
  });

  if (trackingService && connector) {
    try {
      const provider = getConnectorProvider(connector);
      trackingService.trackLLMUsage(provider, modelName);
    } catch (e) {
      // ignore errors
    }
  }
};

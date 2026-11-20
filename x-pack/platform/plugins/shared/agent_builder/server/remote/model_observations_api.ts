/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ConnectorTelemetryMetadata } from '@kbn/inference-common';
import type { InferenceCompleteCallbackHandler } from '@kbn/inference-common/src/chat_complete';

export interface ModelObservationsApi {
  open(
    scopeId: string,
    stepId: string,
    connectorId: string
  ): Promise<{
    lease: string;
    metadata: ConnectorTelemetryMetadata;
  }>;
  report(
    scopeId: string,
    lease: string,
    event: Parameters<InferenceCompleteCallbackHandler>[0]
  ): Promise<void>;
  settle(scopeId: string, stepId: string): Promise<void>;
}

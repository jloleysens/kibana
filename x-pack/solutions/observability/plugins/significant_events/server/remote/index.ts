/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RemoteModule } from '@kbn/core-remote-common';
import { SignificantEventsOperationsToken, WorkflowStepKind } from './tokens';

export const remoteModule: RemoteModule = {
  providers: [
    {
      token: SignificantEventsOperationsToken,
      placement: 'coordinator',
      modulePath: require.resolve('./operations'),
      exportName: 'SignificantEventsOperations',
    },
  ],
  contributions: [
    {
      kind: WorkflowStepKind,
      stepType: 'significantEvents.resolveModel',
      needs: [SignificantEventsOperationsToken],
      modulePath: require.resolve('./resolve_model_step'),
      exportName: 'ResolveModelStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'significantEvents.classifyDetections',
      needs: [SignificantEventsOperationsToken],
      modulePath: require.resolve('./classify_detections_step'),
      exportName: 'ClassifyDetectionsStep',
    },
  ],
};

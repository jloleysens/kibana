/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RemoteModule } from '@kbn/core-remote-common';
import { SpecRuntimeToken, WorkflowConnectorKind } from './tokens';
export const remoteModule: RemoteModule = {
  contributions: [
    {
      kind: WorkflowConnectorKind,
      stepType: 'jenkins',
      modulePath: require.resolve('@kbn/connector-specs/server/remote/jenkins'),
      exportName: 'JenkinsConnector',
    },
  ],
  providers: [
    {
      token: SpecRuntimeToken,
      placement: 'executor',
      modulePath: require.resolve('./spec_runtime'),
      exportName: 'SpecRuntime',
    },
  ],
};

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RemoteModule } from '@kbn/core-remote-common';
import { AlertEventStorageToken, WorkflowStepKind } from './tokens';
export const remoteModule: RemoteModule = {
  providers: [
    {
      token: AlertEventStorageToken,
      placement: 'coordinator',
      modulePath: require.resolve('./storage'),
      exportName: 'ScopedAlertEventStorage',
    },
  ],
  contributions: [
    {
      kind: WorkflowStepKind,
      stepType: 'alerting.create_alert',
      needs: [AlertEventStorageToken],
      modulePath: require.resolve('./create_alert_step'),
      exportName: 'CreateAlertStep',
    },
  ],
};

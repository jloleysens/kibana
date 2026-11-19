/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { RemoteModule } from '@kbn/core-remote-common';

export const remoteModule: RemoteModule = {
  contributions: [
    {
      kind: createToken('workflows.step'),
      stepType: 'nightshift.composeHydrateNotifications',
      modulePath: require.resolve('./compose_hydrate_notifications_step'),
      exportName: 'ComposeHydrateNotificationsStep',
    },
  ],
};

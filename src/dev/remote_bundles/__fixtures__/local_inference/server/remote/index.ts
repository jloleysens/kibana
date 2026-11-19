/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { createToken } from '@kbn/core-di';
import type { RemoteModule } from '@kbn/core-remote-common';
import { NativeActionsToken, SpecRuntimeToken } from '@kbn/actions-plugin/server/remote/tokens';
export const StreamProbeToken = createToken('laneB.streamProbe');
export class BoundActions {
  prepare() {
    throw new Error('Test must bind its scoped Actions fake');
  }
}
export const remoteModule: RemoteModule = {
  providers: [
    {
      token: StreamProbeToken,
      placement: 'executor',
      role: 'root',
      modulePath: require.resolve('./root'),
      exportName: 'StreamProbe',
    },
    {
      token: SpecRuntimeToken,
      placement: 'executor',
      modulePath: require.resolve('@kbn/actions-plugin/server/remote/spec_runtime'),
      exportName: 'SpecRuntime',
    },
    {
      token: NativeActionsToken,
      placement: 'coordinator',
      modulePath: require.resolve('.'),
      exportName: 'BoundActions',
    },
  ],
};

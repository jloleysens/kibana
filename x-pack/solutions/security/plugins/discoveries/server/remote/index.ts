/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RemoteModule } from '@kbn/core-remote-common';
import { AttackDiscoveryOperationsToken, WorkflowStepKind } from './tokens';
export const remoteModule: RemoteModule = {
  providers: [
    {
      token: AttackDiscoveryOperationsToken,
      placement: 'coordinator',
      modulePath: require.resolve('./operations'),
      exportName: 'AttackDiscoveryOperations',
    },
  ],
  contributions: [
    {
      kind: WorkflowStepKind,
      stepType: 'security.attack-discovery.run',
      needs: [AttackDiscoveryOperationsToken],
      modulePath: require.resolve('./run_step'),
      exportName: 'RunStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.attack-discovery.persistDiscoveries',
      needs: [AttackDiscoveryOperationsToken],
      modulePath: require.resolve('./persist_discoveries_step'),
      exportName: 'PersistDiscoveriesStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.attack-discovery.generate',
      needs: [AttackDiscoveryOperationsToken],
      modulePath: require.resolve('./generate_step'),
      exportName: 'GenerateStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.attack-discovery.defaultAlertRetrieval',
      needs: [AttackDiscoveryOperationsToken],
      modulePath: require.resolve('./default_alert_retrieval_step'),
      exportName: 'DefaultAlertRetrievalStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.attack-discovery.defaultValidation',
      needs: [AttackDiscoveryOperationsToken],
      modulePath: require.resolve('./default_validation_step'),
      exportName: 'DefaultValidationStep',
    },
  ],
};

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { createDefaultAlertRetrievalHandler } from '../workflows/steps/default_alert_retrieval_step/default_alert_retrieval_handler';
import { AttackDiscoveryOperationsToken, type AttackDiscoveryOperationsApi } from './tokens';
import { restoreAttackDiscoveryError } from './errors';

export class DefaultAlertRetrievalStep implements RemoteWorkflowStep {
  constructor(
    @inject(AttackDiscoveryOperationsToken) private readonly api: AttackDiscoveryOperationsApi
  ) {}
  async run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    if (!context.handlerContext)
      throw new Error('Attack discovery retrieval requires executor-local handler context');
    const { handlerContext } = context;
    await restoreAttackDiscoveryError(this.api.checkEnabled(scopeId));
    let reference: string | undefined;
    const handler = createDefaultAlertRetrievalHandler({
      getSpaceId: () => restoreAttackDiscoveryError(this.api.getRetrievalSpace(scopeId)),
      prepare: async () => {
        const esClient = await handlerContext.contextManager.getScopedEsClient();
        const ownedReference = await restoreAttackDiscoveryError(this.api.openRetrieval(scopeId));
        reference = ownedReference;
        return {
          esClient,
          resolveConnector: (connectorId) =>
            restoreAttackDiscoveryError(
              this.api.resolveRetrievalConnector(scopeId, ownedReference, connectorId)
            ),
        };
      },
    });
    recordRemoteTiming('attack_discovery_retrieval_native_handler', { scopeId });
    try {
      return await handler(handlerContext as Parameters<typeof handler>[0]);
    } finally {
      if (reference !== undefined)
        await restoreAttackDiscoveryError(this.api.closeRetrieval(scopeId, reference));
    }
  }
}

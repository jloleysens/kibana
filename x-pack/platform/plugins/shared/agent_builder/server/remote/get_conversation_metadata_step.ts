/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import {
  ConversationRegistryToken,
  ConversationDataPlaneToken,
  type ConversationRegistryApi,
  type ConversationDataPlane,
} from './conversation_tokens';
import { getConversationMetadataStepDefinition } from '../workflows/steps/get_conversation_metadata';
import { runConversationStep } from './run_conversation_step';

export class GetConversationMetadataStep implements RemoteWorkflowStep {
  constructor(
    @inject(ConversationRegistryToken) private readonly registry: ConversationRegistryApi,
    @inject(ConversationDataPlaneToken) private readonly data: ConversationDataPlane
  ) {}
  run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    return runConversationStep({
      scopeId,
      context,
      registry: this.registry,
      data: this.data,
      factory: (services) => {
        const definition = getConversationMetadataStepDefinition(services);
        return {
          handler: (handlerContext) =>
            definition.handler(handlerContext as Parameters<typeof definition.handler>[0]),
        };
      },
    });
  }
}

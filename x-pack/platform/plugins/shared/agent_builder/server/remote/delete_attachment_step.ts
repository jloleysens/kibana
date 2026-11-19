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
import { deleteAttachmentStepDefinition } from '../workflows/steps/attachment_delete';
import { AttachmentRegistryToken, type AttachmentRegistryApi } from './attachment_tokens';
import { runAttachmentStep } from './run_attachment_step';

export class DeleteAttachmentStep implements RemoteWorkflowStep {
  constructor(
    @inject(ConversationRegistryToken) private readonly registry: ConversationRegistryApi,
    @inject(ConversationDataPlaneToken) private readonly data: ConversationDataPlane,
    @inject(AttachmentRegistryToken) private readonly attachments: AttachmentRegistryApi
  ) {}
  run(
    ...[scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
  ): ReturnType<RemoteWorkflowStep['run']> {
    return runAttachmentStep({
      scopeId,
      context,
      registry: this.registry,
      data: this.data,
      attachments: this.attachments,
      factory: (services) => {
        const definition = deleteAttachmentStepDefinition(services);
        return {
          handler: (handlerContext) =>
            definition.handler(handlerContext as Parameters<typeof definition.handler>[0]),
        };
      },
    });
  }
}

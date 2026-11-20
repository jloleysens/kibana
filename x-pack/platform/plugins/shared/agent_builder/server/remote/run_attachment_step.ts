/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { recordRemoteTiming } from '@kbn/core-remote-common';
import type { ServerHandlerStepDefinition } from '@kbn/workflows-extensions/server';
import type { AttachmentStepDeps } from '../workflows/attachment_registry';
import type { AttachmentRegistryApi } from './attachment_tokens';
import { runConversationStep } from './run_conversation_step';

/** Runs the original attachment handler and state client locally, draining original conversation hooks. */
export const runAttachmentStep = async ({
  attachments,
  factory,
  ...options
}: Omit<Parameters<typeof runConversationStep>[0], 'factory'> & {
  attachments: AttachmentRegistryApi;
  factory: (services: AttachmentStepDeps) => Pick<ServerHandlerStepDefinition, 'handler'>;
}): Promise<object> =>
  runConversationStep({
    ...options,
    factory: (services) => ({
      handler: async (context) => {
        const { createNativeAttachmentClient } = await import('./native_attachments');
        const request = context.contextManager.getFakeRequest();
        const client = await createNativeAttachmentClient({
          registry: attachments,
          scopeId: options.scopeId,
          request,
          conversationClient: await services.getConversationClient(request),
        });
        recordRemoteTiming('attachment_native_handler', { scopeId: options.scopeId });
        return factory({ getAttachmentClient: async () => client }).handler(context);
      },
    }),
  });

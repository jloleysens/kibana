/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RemoteModule } from '@kbn/core-remote-common';
import { ConversationRegistryToken, WorkflowStepKind } from './conversation_tokens';
export const remoteModule: RemoteModule = {
  providers: [
    {
      token: ConversationRegistryToken,
      placement: 'coordinator',
      modulePath: require.resolve('./conversation_registry'),
      exportName: 'ConversationRegistry',
    },
  ],
  contributions: [
    {
      kind: WorkflowStepKind,
      stepType: 'ai.conversation.create',
      modulePath: require.resolve('./create_conversation_step'),
      exportName: 'CreateConversationStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'ai.conversation.metadata.patch',
      modulePath: require.resolve('./update_conversation_metadata_step'),
      exportName: 'UpdateConversationMetadataStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'ai.conversation.metadata.read',
      modulePath: require.resolve('./get_conversation_metadata_step'),
      exportName: 'GetConversationMetadataStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'ai.conversation.add_event',
      modulePath: require.resolve('./add_conversation_event_step'),
      exportName: 'AddConversationEventStep',
    },
  ],
};

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RemoteModule } from '@kbn/core-remote-common';
import { ConversationRegistryToken, WorkflowStepKind } from './conversation_tokens';
import { AttachmentRegistryToken } from './attachment_tokens';
import { AgentExecutionToken } from './agent_execution_tokens';
export const remoteModule: RemoteModule = {
  providers: [
    {
      token: AgentExecutionToken,
      placement: 'coordinator',
      modulePath: require.resolve('./agent_execution'),
      exportName: 'AgentExecution',
    },
    {
      token: AttachmentRegistryToken,
      placement: 'coordinator',
      modulePath: require.resolve('./attachment_registry'),
      exportName: 'AttachmentRegistry',
    },
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
      stepType: 'ai.conversation.add_user_message',
      modulePath: require.resolve('./add_user_message_step'),
      exportName: 'AddUserMessageStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'search.rerank',
      modulePath: require.resolve('./rerank_step'),
      exportName: 'RerankStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'ai.attachment.list',
      modulePath: require.resolve('./list_attachment_step'),
      exportName: 'ListAttachmentStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'ai.attachment.read',
      modulePath: require.resolve('./read_attachment_step'),
      exportName: 'ReadAttachmentStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'ai.attachment.delete',
      modulePath: require.resolve('./delete_attachment_step'),
      exportName: 'DeleteAttachmentStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'ai.attachment.update',
      modulePath: require.resolve('./update_attachment_step'),
      exportName: 'UpdateAttachmentStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'ai.attachment.add',
      modulePath: require.resolve('./add_attachment_step'),
      exportName: 'AddAttachmentStep',
    },
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

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { ConversationAddEventInput, ConversationTemplate } from '@kbn/agent-builder-common';
import type { ElasticsearchClient } from '@kbn/core/server';
import type {
  createClient,
  ConversationWriteVersion,
} from '../services/conversation/client/client';

export const CONVERSATION_LOG_LEVELS = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
] as const;
export type ConversationLogLevel = (typeof CONVERSATION_LOG_LEVELS)[number];
type LogLevels = Record<ConversationLogLevel, boolean>;

type ClientOptions = Parameters<typeof createClient>[0];
export type ConversationNotification =
  | {
      operation: 'created' | 'fieldsChanged' | 'emitConversationUpdated' | 'emitMetadataPatched';
      conversationId: string;
      writeLeaseId: string;
    }
  | {
      operation: 'emitAttachmentEvents';
      conversationId: string;
      writeLeaseId: string;
      eventIds: string[];
    }
  | {
      operation: 'log';
      payload: { namespace: 'client' | 'storage'; level: ConversationLogLevel; message: string };
    };
export interface ConversationPolicy extends Pick<ClientOptions, 'user' | 'space'> {
  clientLeaseId: string;
  templates: ConversationTemplate[];
  logging: { client: LogLevels; storage: LogLevels };
  emitsEvents: boolean;
  reportsCreation: boolean;
  reportsFieldChanges: boolean;
}
export interface ConversationRegistryApi {
  read(scopeId: string): Promise<ConversationPolicy>;
  assertAgentUse(scopeId: string, clientLeaseId: string, agentId: string): Promise<void>;
  accessibleAgentIds(scopeId: string, clientLeaseId: string): Promise<string[]>;
  validateEvents(
    scopeId: string,
    clientLeaseId: string,
    events: ConversationAddEventInput[]
  ): Promise<ConversationAddEventInput[]>;
  prepareWrite(
    scopeId: string,
    clientLeaseId: string,
    conversationId: string,
    expected?: Pick<ConversationWriteVersion, 'seqNo' | 'primaryTerm'>
  ): Promise<{ writeLeaseId: string; version?: ConversationWriteVersion }>;
  notify(
    scopeId: string,
    clientLeaseId: string,
    notifications: ConversationNotification[]
  ): Promise<void>;
}
export const ConversationRegistryToken = createToken<ConversationRegistryApi>(
  'agentBuilder.conversationRegistry'
);

export const WorkflowStepKind = createToken('workflows.step');
export interface ConversationDataPlane {
  internal(scopeId: string): ElasticsearchClient;
}
export const ConversationDataPlaneToken = createToken<ConversationDataPlane>('workflows.dataPlane');

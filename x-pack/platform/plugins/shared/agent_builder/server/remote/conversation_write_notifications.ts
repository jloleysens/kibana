/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'node:crypto';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import {
  chatSystemIndex,
  createConversationAlreadyExistsError,
  createConversationWriteConflictError,
  isAttachmentEvent,
  isConversationNotFoundError,
} from '@kbn/agent-builder-common';
import { createClient, type ConversationWriteState } from '../services/conversation/client/client';
import { getTemplate } from '../services/conversation/templates/registry';
import { describeConversationFieldsChanged } from '../telemetry/describe_conversation_fields_changed';
import {
  describeConversationWrite,
  diffMetadata,
} from '../workflows/triggers/describe_conversation_write';
import type { ConversationNotification, ConversationRegistryApi } from './conversation_tokens';

type ClientOptions = Parameters<typeof createClient>[0];
interface WriteLease {
  conversationId: string;
  before?: ConversationWriteState;
}

/** Authorizes version-bound writes and rebuilds original hooks exclusively from persisted snapshots. */
export class ConversationWriteNotifications {
  readonly #writes = new Map<string, WriteLease>();
  readonly #client: ReturnType<typeof createClient>;

  constructor(private readonly scopeId: string, private readonly context: ClientOptions) {
    this.#client = createClient(context);
  }

  async #read(
    conversationId: string,
    phase: 'prepare' | 'notify'
  ): Promise<ConversationWriteState> {
    const started = performance.now();
    const cpu = process.cpuUsage();
    try {
      return await this.#client.getWriteState(conversationId);
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('conversation_authorization_read', {
        scopeId: this.scopeId,
        stepType: phase,
        durationMs: performance.now() - started,
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }

  async prepare(
    conversationId: string,
    expected: Parameters<ConversationRegistryApi['prepareWrite']>[3]
  ): ReturnType<ConversationRegistryApi['prepareWrite']> {
    let before: ConversationWriteState | undefined;
    try {
      before = await this.#read(conversationId, 'prepare');
    } catch (error) {
      if (expected || !isConversationNotFoundError(error)) throw error;
    }
    if (!expected && before) throw createConversationAlreadyExistsError({ conversationId });
    if (
      expected &&
      (!before ||
        expected.seqNo !== before.version.seqNo ||
        expected.primaryTerm !== before.version.primaryTerm)
    )
      throw createConversationWriteConflictError({ conversationId });
    const writeLeaseId = randomUUID();
    this.#writes.set(writeLeaseId, { conversationId, before });
    return { writeLeaseId, version: before?.version };
  }

  async notify(notifications: ConversationNotification[]): Promise<void> {
    const after = new Map<string, ConversationWriteState | undefined>();
    const admitted = new Set<string>();
    for (const notification of notifications) {
      if (notification.operation === 'log') continue;
      const key = `${notification.writeLeaseId}:${notification.operation}`;
      if (admitted.has(key)) throw new Error('Duplicate conversation write notification');
      admitted.add(key);
      const lease = this.#writes.get(notification.writeLeaseId);
      if (!lease || lease.conversationId !== notification.conversationId)
        throw new Error('Conversation notification does not belong to its authorized write');
      if (!after.has(notification.writeLeaseId)) {
        const current = await this.#read(lease.conversationId, 'notify');
        const expectedRevision = (lease.before?.version.revision ?? 0) + 1;
        if (current.version.revision !== expectedRevision) {
          this.context.logger.warn(
            `Skipped conversation notification for "${lease.conversationId}": expected document version ${expectedRevision}, found ${current.version.revision}`
          );
          after.set(notification.writeLeaseId, undefined);
        } else after.set(notification.writeLeaseId, current);
      }
      const current = after.get(notification.writeLeaseId);
      if (!current) continue;
      if (notification.operation === 'created' && lease.before)
        throw new Error('Conversation creation notification requires an original create');
      if (notification.operation === 'emitMetadataPatched' && !lease.before)
        throw new Error('Conversation metadata notification requires an original update');
      if (notification.operation === 'emitAttachmentEvents') {
        const ids = new Set(notification.eventIds);
        const previousIds = new Set(lease.before?.conversation.events?.map(({ id }) => id));
        const events = current.conversation.events?.filter(({ id }) => ids.has(id)) ?? [];
        if (
          ids.size !== notification.eventIds.length ||
          events.length !== ids.size ||
          events.some(
            (event) => !isAttachmentEvent(event) || event.data.hidden || previousIds.has(event.id)
          )
        )
          throw new Error('Conversation attachment event is not part of its authorized write');
      }
    }
    for (const notification of notifications) {
      try {
        if (notification.operation === 'log') {
          const target =
            notification.payload.namespace === 'storage'
              ? this.context.logger.get('storage').get(chatSystemIndex('conversations'))
              : this.context.logger;
          target[notification.payload.level](notification.payload.message);
          continue;
        }
        const current = after.get(notification.writeLeaseId);
        const lease = this.#writes.get(notification.writeLeaseId);
        if (!current || !lease) continue;
        const conversation = current.conversation;
        const describe = {
          before: lease.before?.conversation,
          after: conversation,
          source: 'workflow' as const,
        };
        switch (notification.operation) {
          case 'created':
            this.context.onConversationCreated?.({
              conversationId: conversation.id,
              agentId: conversation.agent_id,
            });
            break;
          case 'fieldsChanged': {
            const payload = describeConversationFieldsChanged({
              ...describe,
              resolveTemplate: this.context.templateLookup ?? getTemplate,
            });
            if (payload) this.context.reportFieldsChange?.(payload);
            break;
          }
          case 'emitConversationUpdated': {
            const payload = describeConversationWrite(describe);
            if (payload) this.context.eventEmitter?.emitConversationUpdated(payload);
            break;
          }
          case 'emitMetadataPatched': {
            const changedFields = diffMetadata(
              lease.before?.conversation.metadata ?? {},
              conversation.metadata ?? {}
            );
            if (changedFields.length > 0)
              this.context.eventEmitter?.emitMetadataPatched({
                conversationId: conversation.id,
                ...(conversation.template_id ? { templateId: conversation.template_id } : {}),
                ...(conversation.parent_conversation
                  ? { parentId: conversation.parent_conversation.id }
                  : {}),
                changedFields,
              });
            break;
          }
          case 'emitAttachmentEvents': {
            const ids = new Set(notification.eventIds);
            this.context.eventEmitter?.emitAttachmentEvents({
              conversationId: conversation.id,
              events: (conversation.events ?? [])
                .filter(isAttachmentEvent)
                .filter(({ id }) => ids.has(id)),
            });
            break;
          }
        }
      } catch (error) {
        this.context.logger.warn(`Failed to notify conversation write: ${error}`);
      }
    }
  }
}

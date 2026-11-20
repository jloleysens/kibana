/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'node:crypto';
import { chatSystemIndex } from '@kbn/agent-builder-common';
import type { KibanaRequest } from '@kbn/core/server';
import { remotable, recordRemoteTiming } from '@kbn/core-remote-common';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { createRegistryTransportError } from './registry_errors';
import { ConversationWriteNotifications } from './conversation_write_notifications';
import type { createClient } from '../services/conversation/client/client';
import { listTemplates } from '../services/conversation/templates/registry';
import { validateConversationEvents } from '../services/conversation_events/validation';
import type {
  ConversationRegistryApi,
  ConversationNotification,
  ConversationPolicy,
} from './conversation_tokens';
import { CONVERSATION_LOG_LEVELS } from './conversation_tokens';

type ClientOptions = Parameters<typeof createClient>[0];

/** Keeps live registry validation and original notification hooks scoped to the authenticated run. */
@remotable()
export class ConversationRegistry implements ConversationRegistryApi {
  readonly #clients = new Map<
    string,
    {
      scopeId: string;
      context: ClientOptions;
      writes: ConversationWriteNotifications;
      release(): void;
    }
  >();
  readonly #scopeClients = new Map<string, { ids: Set<string>; cleanup(): void }>();
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly getOptions: (request: KibanaRequest) => Promise<ClientOptions>
  ) {}

  async #call<T>(
    scopeId: string,
    operation: string,
    payload: object,
    run: (context: ClientOptions, signal: AbortSignal) => Promise<T>,
    clientLeaseId?: string
  ): Promise<T> {
    const started = performance.now();
    const cpu = process.cpuUsage();
    try {
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      const request = this.scopes.get<KibanaRequest>(scopeId);
      let context: ClientOptions;
      if (operation === 'read') context = await this.getOptions(request);
      else {
        const client = clientLeaseId ? this.#clients.get(clientLeaseId) : undefined;
        if (!client || client.scopeId !== scopeId)
          throw new Error('Conversation client lease is not owned by this run');
        context = client.context;
      }
      signal.throwIfAborted();
      const result = await run(context, signal);
      signal.throwIfAborted();
      return result;
    } catch (error) {
      throw createRegistryTransportError(error);
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('agent_builder_registry', {
        scopeId,
        stepType: operation,
        durationMs: performance.now() - started,
        payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }
  read(scopeId: string): ReturnType<ConversationRegistryApi['read']> {
    return this.#call(scopeId, 'read', {}, async (context, signal) => {
      const clientLeaseId = randomUUID();
      const policy: ConversationPolicy = {
        clientLeaseId,
        user: structuredClone(context.user),
        space: context.space,
        templates: listTemplates(),
        logging: {
          client: Object.fromEntries(
            CONVERSATION_LOG_LEVELS.map((level) => [level, context.logger.isLevelEnabled(level)])
          ) as ConversationPolicy['logging']['client'],
          storage: Object.fromEntries(
            CONVERSATION_LOG_LEVELS.map((level) => [
              level,
              context.logger
                .get('storage')
                .get(chatSystemIndex('conversations'))
                .isLevelEnabled(level),
            ])
          ) as ConversationPolicy['logging']['storage'],
        },
        emitsEvents: context.eventEmitter !== undefined,
        reportsCreation: context.onConversationCreated !== undefined,
        reportsFieldChanges: context.reportFieldsChange !== undefined,
      };
      let group = this.#scopeClients.get(scopeId);
      if (!group) {
        const ids = new Set<string>();
        const cleanup = () => {
          for (const id of ids) this.#clients.delete(id);
          ids.clear();
          this.#scopeClients.delete(scopeId);
          signal.removeEventListener('abort', cleanup);
        };
        group = { ids, cleanup };
        this.#scopeClients.set(scopeId, group);
        signal.addEventListener('abort', cleanup, { once: true });
      }
      const owner = group;
      const release = () => {
        this.#clients.delete(clientLeaseId);
        owner.ids.delete(clientLeaseId);
        if (owner.ids.size === 0) owner.cleanup();
      };
      this.#clients.set(clientLeaseId, {
        scopeId,
        context,
        release,
        writes: new ConversationWriteNotifications(scopeId, context),
      });
      owner.ids.add(clientLeaseId);
      return policy;
    });
  }
  assertAgentUse(scopeId: string, clientLeaseId: string, agentId: string): Promise<void> {
    return this.#call(
      scopeId,
      'assertAgentUse',
      { agentId },
      async (context) => {
        await context.agentRegistry.get(agentId, { access: 'use' });
      },
      clientLeaseId
    );
  }
  accessibleAgentIds(scopeId: string, clientLeaseId: string): Promise<string[]> {
    return this.#call(
      scopeId,
      'accessibleAgentIds',
      {},
      (context) => context.agentRegistry.getIds(),
      clientLeaseId
    );
  }
  validateEvents(
    ...[scopeId, clientLeaseId, events]: Parameters<ConversationRegistryApi['validateEvents']>
  ): ReturnType<ConversationRegistryApi['validateEvents']> {
    return this.#call(
      scopeId,
      'validateEvents',
      events,
      async (context) => {
        if (!context.conversationEvents)
          throw new Error('Original conversation event registry is unavailable');
        return validateConversationEvents(events, context.conversationEvents);
      },
      clientLeaseId
    );
  }
  prepareWrite(
    ...[scopeId, clientLeaseId, conversationId, expected]: Parameters<
      ConversationRegistryApi['prepareWrite']
    >
  ): ReturnType<ConversationRegistryApi['prepareWrite']> {
    return this.#call(
      scopeId,
      'prepareWrite',
      { conversationId, expected },
      async () => {
        const client = this.#clients.get(clientLeaseId);
        if (!client) throw new Error('Conversation client lease is closed');
        return client.writes.prepare(conversationId, expected);
      },
      clientLeaseId
    );
  }
  notify(
    scopeId: string,
    clientLeaseId: string,
    notifications: ConversationNotification[]
  ): Promise<void> {
    return this.#call(
      scopeId,
      'notify',
      notifications,
      async () => {
        const client = this.#clients.get(clientLeaseId);
        if (!client) throw new Error('Conversation client lease is closed');
        try {
          await client.writes.notify(notifications);
        } finally {
          client.release();
        }
      },
      clientLeaseId
    );
  }
}

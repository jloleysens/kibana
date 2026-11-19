/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import {
  createClient,
  type ConversationAgentRegistry,
} from '../services/conversation/client/client';
import type {
  ConversationRegistryApi,
  ConversationNotification,
  ConversationLogLevel,
} from './conversation_tokens';

import { restoreRegistryError } from './registry_errors';

/** Runs the original storage/OCC/ACL client with per-run identity and live registry callbacks. */
export const createNativeConversation = async ({
  registry,
  scopeId,
  esClient,
  logger,
}: {
  registry: ConversationRegistryApi;
  scopeId: string;
  esClient: ElasticsearchClient;
  logger: Logger;
}) => {
  const policy = await restoreRegistryError(registry.read(scopeId));
  const notifications: ConversationNotification[] = [];
  const agentRegistry: ConversationAgentRegistry = {
    get: async (id, options) => {
      if (options?.access !== 'use')
        throw new Error('Conversation worker only admits explicit agent use checks');
      await restoreRegistryError(registry.assertAgentUse(scopeId, policy.clientLeaseId, id));
    },
    getIds: async (options) => {
      if (options)
        throw new Error('Conversation worker only admits original accessible-agent listing');
      return restoreRegistryError(registry.accessibleAgentIds(scopeId, policy.clientLeaseId));
    },
  };
  const templates = new Map(policy.templates.map((template) => [template.id, template]));
  const scopedLogger = (namespace: 'client' | 'storage'): Logger => {
    const levels = policy.logging[namespace];
    const write = (level: ConversationLogLevel, message: Parameters<Logger['warn']>[0]) => {
      if (levels[level])
        notifications.push({
          operation: 'log',
          payload: {
            namespace,
            level,
            message:
              message instanceof Error
                ? message.message
                : typeof message === 'function'
                ? message()
                : message,
          },
        });
    };
    return {
      get: (...names) =>
        scopedLogger(namespace === 'storage' || names.includes('storage') ? 'storage' : 'client'),
      log: (record) => {
        const level = record.level.id;
        if (
          level === 'trace' ||
          level === 'debug' ||
          level === 'info' ||
          level === 'warn' ||
          level === 'error' ||
          level === 'fatal'
        )
          write(level, record.message);
      },
      trace: (message) => write('trace', message),
      debug: (message) => write('debug', message),
      info: (message) => write('info', message),
      warn: (message) => write('warn', message),
      error: (message) => write('error', message),
      fatal: (message) => write('fatal', message),
      isLevelEnabled: (level) =>
        level === 'all' ? levels.trace : level === 'off' ? false : levels[level],
    };
  };
  const client = createClient({
    user: policy.user,
    space: policy.space,
    esClient,
    logger: scopedLogger('client'),
    agentRegistry,
    templateLookup: (id) => templates.get(id),
    validateEvents: (events) =>
      restoreRegistryError(registry.validateEvents(scopeId, policy.clientLeaseId, events)),
    ...(policy.emitsEvents
      ? {
          eventEmitter: {
            emitAttachmentEvents: (payload) => {
              notifications.push({ operation: 'emitAttachmentEvents', payload });
            },
            emitConversationUpdated: (payload) => {
              notifications.push({ operation: 'emitConversationUpdated', payload });
            },
            emitMetadataPatched: (payload) => {
              notifications.push({ operation: 'emitMetadataPatched', payload });
            },
          },
        }
      : {}),
    ...(policy.reportsCreation
      ? {
          onConversationCreated: (payload) => {
            notifications.push({ operation: 'created', payload });
          },
        }
      : {}),
    ...(policy.reportsFieldChanges
      ? {
          reportFieldsChange: (payload) => {
            notifications.push({ operation: 'fieldsChanged', payload });
          },
        }
      : {}),
  });
  let completion: Promise<void> | undefined;
  return {
    client,
    agentRegistry,
    drain: () =>
      (completion ??= (async () => {
        try {
          await registry.notify(scopeId, policy.clientLeaseId, notifications.splice(0));
        } catch (error) {
          logger.warn(`Failed to notify conversation write: ${error}`);
        }
      })()),
  };
};

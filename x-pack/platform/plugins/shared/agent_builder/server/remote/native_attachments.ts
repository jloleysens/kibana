/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import type { AttachmentStateTypeDefinition } from '@kbn/agent-builder-server/attachments';
import type { ConversationClient } from '../services/conversation/client/client';
import { createAttachmentPublicClient } from '../services/attachments/attachment_public_client';
import type { AttachmentRegistryApi } from './attachment_tokens';
import { restoreRegistryError } from './registry_errors';

/** Uses original native attachment state/OCC with live authenticated validation and origin resolution. */
export const createNativeAttachmentClient = async ({
  registry,
  scopeId,
  request,
  conversationClient,
}: {
  registry: AttachmentRegistryApi;
  scopeId: string;
  request: KibanaRequest;
  conversationClient: ConversationClient;
}) => {
  const policies = await restoreRegistryError(registry.describe(scopeId));
  const resolveOrigin = (type: string, origin: string) =>
    restoreRegistryError(registry.resolve(scopeId, type, origin));
  const definitions = new Map<string, AttachmentStateTypeDefinition>(
    policies.map(({ id, isReadonly, canResolve }) => [
      id,
      {
        id,
        isReadonly,
        validate: (data) => restoreRegistryError(registry.validate(scopeId, id, data)),
        ...(canResolve ? { resolve: (origin: string) => resolveOrigin(id, origin) } : {}),
      },
    ])
  );
  return createAttachmentPublicClient({
    request,
    conversationsService: { getScopedClient: async () => conversationClient },
    attachmentsService: { getTypeDefinition: (type) => definitions.get(type) },
    resolveOrigin,
    source: 'workflow',
  });
};

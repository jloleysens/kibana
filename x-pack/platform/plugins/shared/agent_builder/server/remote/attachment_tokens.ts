/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { AttachmentStateTypeDefinition } from '@kbn/agent-builder-server/attachments';

export interface AttachmentTypePolicy {
  id: string;
  isReadonly?: boolean;
  canResolve: boolean;
}
export interface AttachmentRegistryApi {
  describe(scopeId: string): Promise<AttachmentTypePolicy[]>;
  validate(
    scopeId: string,
    type: string,
    data: Parameters<AttachmentStateTypeDefinition['validate']>[0]
  ): Promise<Awaited<ReturnType<AttachmentStateTypeDefinition['validate']>>>;
  resolve(
    scopeId: string,
    type: string,
    origin: string
  ): Promise<Awaited<ReturnType<NonNullable<AttachmentStateTypeDefinition['resolve']>>>>;
}
export const AttachmentRegistryToken = createToken<AttachmentRegistryApi>(
  'agentBuilder.attachmentRegistry'
);

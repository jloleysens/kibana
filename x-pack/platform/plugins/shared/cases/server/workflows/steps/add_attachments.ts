/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server/step_registry/types';
import { buildAddAttachmentsStepCommonDefinition } from '../../../common/workflows/steps/add_attachments';
import type { UnifiedAttachmentTypeRegistry } from '../../attachment_framework/unified_attachment_registry';
import type { WorkflowCasesClient as CasesClient } from '../types';
import { createAddAttachmentsHandler } from './add_attachments_handler';
import { selectAuthorableAttachmentSchemas } from './unified_attachment_schemas';

/**
 * Builds the `cases.addAttachments` server step definition, or returns
 * `undefined` when no authorable attachment type is registered — which the
 * step registry treats as a silently skipped registration.
 *
 * Must be invoked from a deferred loader (async import) at `setup` so the
 * registry has been populated by solution plugins whose `setup` runs after
 * cases's. Composing the union eagerly at cases `setup` would snapshot only
 * the built-in types (see PR #269993 review).
 */
export const addAttachmentsStepDefinition = (
  unifiedAttachmentTypeRegistry: UnifiedAttachmentTypeRegistry,
  getCasesClient: (request: KibanaRequest) => Promise<CasesClient>
) => {
  const members = selectAuthorableAttachmentSchemas(unifiedAttachmentTypeRegistry);
  if (members.length === 0) {
    return undefined;
  }

  const definition = buildAddAttachmentsStepCommonDefinition(members);

  return createServerStepDefinition({
    ...definition,
    handler: createAddAttachmentsHandler(getCasesClient, definition.outputSchema),
  });
};

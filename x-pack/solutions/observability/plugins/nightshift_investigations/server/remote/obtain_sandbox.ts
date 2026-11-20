/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler } from '@kbn/workflows-extensions/server';
import type { inputSchema, outputSchema } from '../step_definitions/obtain_sandbox';
import { scopeConversationId } from '../tools/sandbox_bash/tool_utils';

type Handler = StepHandler<typeof inputSchema, typeof outputSchema>;
export const createObtainSandboxHandler =
  (
    allocate: (
      context: Parameters<Handler>[0],
      conversationId: string,
      required: boolean
    ) => Promise<{ skipped?: boolean }>
  ): Handler =>
  async (context) => {
    const { conversation_id: conversationId, required = true } = context.input;
    const { spaceId } = context.contextManager.getContext().workflow;
    const sandboxId = scopeConversationId(spaceId, conversationId);
    const result = await allocate(context, conversationId, required);
    return { output: { sandbox_id: sandboxId, conversation_id: conversationId, ...result } };
  };

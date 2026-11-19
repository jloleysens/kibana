/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';

export interface AgentExecutionApi {
  appendUserMessage(
    scopeId: string,
    conversationId: string,
    message: string,
    authorName?: string
  ): Promise<void>;
}
export const AgentExecutionToken = createToken<AgentExecutionApi>('agentBuilder.agentExecution');

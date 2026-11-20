/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import { AgentExecutionMode, ChatTriggerMode } from '@kbn/agent-builder-common';
import type { AgentExecutionService } from '@kbn/agent-builder-server/execution';
import type { AgentExecutionApi } from './agent_execution_tokens';
import { createRegistryTransportError } from './registry_errors';

/** Retains original authenticated execution-service operations without exposing whole workflow handlers. */
@remotable()
export class AgentExecution implements AgentExecutionApi {
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly getService: () => Pick<AgentExecutionService, 'maybeExecuteAgent'>
  ) {}

  async appendUserMessage(
    scopeId: string,
    conversationId: string,
    message: string,
    authorName?: string
  ): Promise<void> {
    const started = performance.now();
    const cpu = process.cpuUsage();
    try {
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      const request = this.scopes.get<KibanaRequest>(scopeId);
      await this.getService().maybeExecuteAgent({
        mode: AgentExecutionMode.conversation,
        request,
        params: {
          conversationId,
          nextInput: { message },
          triggerMode: ChatTriggerMode.Never,
          ...(authorName ? { author: { full_name: authorName } } : {}),
        },
      });
      signal.throwIfAborted();
    } catch (error) {
      throw createRegistryTransportError(error);
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('agent_builder_append_user_message', {
        scopeId,
        durationMs: performance.now() - started,
        payloadBytes: Buffer.byteLength(JSON.stringify({ conversationId, message, authorName })),
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }
}

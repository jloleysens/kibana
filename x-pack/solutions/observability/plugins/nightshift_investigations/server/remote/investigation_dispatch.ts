/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'node:crypto';
import type { KibanaRequest } from '@kbn/core/server';
import { withRemoteLeaseParent, type ScopeLookup } from '@kbn/core-remote-server';
import { recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import type { InvestigationDispatchApi } from './investigation_dispatch_tokens';
import type {
  createInvestigationDispatchOperations,
  PreparedInvestigationDispatch,
} from './investigation_dispatch_operations';
import { InvestigationQuotaDeniedError } from '../client/errors';
import { createDispatchTransportError } from './dispatch_errors';

interface PendingDispatch {
  prepared: PreparedInvestigationDispatch;
  started: boolean;
  quotaThread?: NonNullable<Parameters<InvestigationDispatchApi['start']>[2]['slack_thread']>;
}

/** Original dispatch authorization, automation budgets and live alert services stay request-scoped. */
@remotable()
export class InvestigationDispatch implements InvestigationDispatchApi {
  readonly #prepared = new Map<string, Map<string, PendingDispatch>>();
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly operations: ReturnType<typeof createInvestigationDispatchOperations>
  ) {}

  async prepare(scopeId: string, automationId?: string): Promise<string> {
    return this.#call(scopeId, { automationId }, async () => {
      const request = this.scopes.get<KibanaRequest>(scopeId);
      const { spaceId, workflowId } = this.scopes.getRunState(scopeId);
      const prepared = await this.operations.prepare(request, spaceId, workflowId, automationId);
      this.scopes.getAbortSignal(scopeId).throwIfAborted();
      let entries = this.#prepared.get(scopeId);
      if (!entries) {
        entries = new Map();
        this.#prepared.set(scopeId, entries);
        this.scopes
          .getAbortSignal(scopeId)
          .addEventListener('abort', () => this.#prepared.delete(scopeId), { once: true });
      }
      const reference = randomUUID();
      entries.set(reference, { prepared, started: false });
      return reference;
    });
  }
  async resolveAlerts(
    scopeId: string,
    subjectId: string
  ): ReturnType<InvestigationDispatchApi['resolveAlerts']> {
    return this.#call(scopeId, { subjectId }, () =>
      this.operations.resolveAlerts(
        this.scopes.get<KibanaRequest>(scopeId),
        this.scopes.getRunState(scopeId).spaceId,
        subjectId
      )
    );
  }
  async start(
    scopeId: string,
    reference: string,
    input: Parameters<InvestigationDispatchApi['start']>[2]
  ): ReturnType<InvestigationDispatchApi['start']> {
    return this.#call(scopeId, input, async () => {
      const entries = this.#prepared.get(scopeId);
      const pending = entries?.get(reference);
      if (!entries || !pending || pending.started)
        throw new Error('Dispatch reference is not owned by this run');
      pending.started = true;
      const {
        subject,
        title,
        trigger_type,
        message,
        source_ids,
        context,
        timeout_seconds,
        notificationDestinations,
        slack_thread,
      } = input;
      try {
        return await withRemoteLeaseParent(this.scopes, scopeId, () =>
          this.operations.start(pending.prepared, {
            subject: { type: subject.type, id: subject.id, summary: subject.summary },
            title,
            trigger_type,
            message,
            source_ids,
            context,
            timeout_seconds,
            notificationDestinations,
            slack_thread,
          })
        );
      } catch (error) {
        if (error instanceof InvestigationQuotaDeniedError && slack_thread)
          pending.quotaThread = slack_thread;
        throw error;
      } finally {
        if (!pending.quotaThread) entries.delete(reference);
      }
    });
  }
  async notifyQuota(scopeId: string, reference: string, kibanaUrl: string): Promise<string[]> {
    return this.#call(scopeId, { reference }, async () => {
      const entries = this.#prepared.get(scopeId);
      const pending = entries?.get(reference);
      if (!pending?.quotaThread)
        throw new Error("Quota notice requires this run's denied dispatch");
      entries?.delete(reference);
      const warnings: string[] = [];
      await this.operations.notifyQuota(
        this.scopes.get<KibanaRequest>(scopeId),
        this.scopes.getRunState(scopeId).spaceId,
        kibanaUrl,
        this.scopes.getAbortSignal(scopeId),
        { warn: (message) => warnings.push(String(message)) },
        pending.quotaThread
      );
      return warnings;
    });
  }
  async #call<T>(scopeId: string, payload: object, operation: () => Promise<T>): Promise<T> {
    const started = performance.now();
    const cpu = process.cpuUsage();
    try {
      this.scopes.getAbortSignal(scopeId).throwIfAborted();
      this.scopes.getRunState(scopeId);
      const result = await operation();
      this.scopes.getAbortSignal(scopeId).throwIfAborted();
      return result;
    } catch (error) {
      throw createDispatchTransportError(error);
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('nightshift_investigation_dispatch', {
        scopeId,
        durationMs: performance.now() - started,
        payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }
}

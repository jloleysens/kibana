/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'node:crypto';
import { brandSpaceId } from '@kbn/core-spaces-common';
import type { KibanaRequest } from '@kbn/core/server';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { remotable } from '@kbn/core-remote-common';
import type { InvestigationNotificationDeps } from '../lib/notifications/send_investigation_notifications';
import type { NotificationRoutingClient } from '../lib/notifications/notification_routing_client';
import type { GetTriggerEmitter } from '../types';
import { emitInvestigationFailure } from '../lib/notifications/emit_investigation_failure';
import { createInvestigationTransportError } from './investigation_errors';
import type { NotificationAuthorityApi } from './notification_authority_tokens';

type OpenedContext = Awaited<ReturnType<NotificationAuthorityApi['open']>>['context'];
interface Entry {
  scopeId: string;
  stepType: string;
  investigationId: string;
  context: OpenedContext;
  routing: NotificationRoutingClient;
}
/** Owns original scoped investigation/attachment persistence and lifecycle emission, not delivery. */
@remotable()
export class NotificationAuthority implements NotificationAuthorityApi {
  readonly #entries = new Map<string, Entry>();
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly deps: InvestigationNotificationDeps & { getTriggerEmitter: GetTriggerEmitter }
  ) {}
  #step(scopeId: string, stepId: string): string {
    this.scopes.getAbortSignal(scopeId).throwIfAborted();
    this.scopes.getRunState(scopeId);
    const type = this.scopes.resolveStepType(scopeId, stepId);
    if (type !== 'nightshift.sendNotifications' && type !== 'nightshift.handleInvestigationFailure')
      throw new Error('Unknown notification step');
    return type;
  }
  #entry(scopeId: string, reference: string): Entry {
    this.scopes.getAbortSignal(scopeId).throwIfAborted();
    this.scopes.getRunState(scopeId);
    const entry = this.#entries.get(reference);
    if (!entry || entry.scopeId !== scopeId)
      throw new Error('Notification reference is not owned by this run');
    return entry;
  }
  #client(scopeId: string) {
    return this.deps.getInvestigationsClient(
      this.scopes.get<KibanaRequest>(scopeId),
      this.scopes.getRunState(scopeId).spaceId
    );
  }
  async #call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw createInvestigationTransportError(error);
    }
  }
  async open(
    scopeId: string,
    stepId: string,
    investigationId: string
  ): ReturnType<NotificationAuthorityApi['open']> {
    return this.#call(async () => {
      const stepType = this.#step(scopeId, stepId);
      const request = this.scopes.get<KibanaRequest>(scopeId);
      const { spaceId, workflowRunId } = this.scopes.getRunState(scopeId);
      const context = await this.#client(scopeId).getInvestigationExecutionContext(
        investigationId,
        workflowRunId
      );
      const routing = await this.deps.getRoutingClient(
        request,
        spaceId,
        context.conversationId,
        investigationId
      );
      this.scopes.getAbortSignal(scopeId).throwIfAborted();
      const reference = randomUUID();
      this.#entries.set(reference, { scopeId, stepType, investigationId, context, routing });
      this.scopes
        .getAbortSignal(scopeId)
        .addEventListener('abort', () => this.#entries.delete(reference), { once: true });
      return {
        reference,
        context,
        redirectUrl: this.deps.investigationLocator.getRedirectUrl(
          { investigationId },
          { spaceId }
        ),
      };
    });
  }
  async ensureFailure(scopeId: string, stepId: string, investigationId: string): Promise<void> {
    return this.#call(async () => {
      if (this.#step(scopeId, stepId) !== 'nightshift.handleInvestigationFailure')
        throw new Error('Not a failure handler');
      await this.#client(scopeId).ensureForFailure(
        investigationId,
        this.scopes.getRunState(scopeId).workflowRunId
      );
    });
  }
  async emitFailure(scopeId: string, reference: string): Promise<void> {
    return this.#call(async () => {
      const entry = this.#entry(scopeId, reference);
      if (entry.stepType !== 'nightshift.handleInvestigationFailure')
        throw new Error('Not a failure handler');
      const { workflowRunId } = this.scopes.getRunState(scopeId);
      const routing = await entry.routing.get();
      if (routing?.executions.find(({ id }) => id === workflowRunId)?.terminal_phase !== 'failed')
        throw new Error('Failure phase was not selected');
      await emitInvestigationFailure({
        request: this.scopes.get<KibanaRequest>(scopeId),
        client: this.#client(scopeId),
        getTriggerEmitter: this.deps.getTriggerEmitter,
        investigationId: entry.investigationId,
      });
    });
  }
  async get(scopeId: string, reference: string): ReturnType<NotificationAuthorityApi['get']> {
    return this.#call(() => this.#entry(scopeId, reference).routing.get());
  }
  async isActive(scopeId: string, reference: string): Promise<boolean> {
    return this.#call(() => this.#entry(scopeId, reference).routing.isActive());
  }
  async initialize(
    scopeId: string,
    reference: string
  ): ReturnType<NotificationAuthorityApi['initialize']> {
    return this.#call(() => {
      const { routing, context } = this.#entry(scopeId, reference);
      return routing.initialize(
        this.scopes.getRunState(scopeId).workflowRunId,
        context.workflowId,
        context.notificationDestinations
      );
    });
  }
  async selectTerminalPhase(
    scopeId: string,
    reference: string,
    phase: 'completed' | 'failed'
  ): ReturnType<NotificationAuthorityApi['selectTerminalPhase']> {
    return this.#call(() =>
      this.#entry(scopeId, reference).routing.selectTerminalPhase(
        this.scopes.getRunState(scopeId).workflowRunId,
        phase
      )
    );
  }
  async claim(
    scopeId: string,
    reference: string,
    destinationId: string,
    phase: Parameters<NotificationAuthorityApi['claim']>[3],
    attemptId: string,
    createsRoot: boolean
  ): ReturnType<NotificationAuthorityApi['claim']> {
    return this.#call(() =>
      this.#entry(scopeId, reference).routing.claim(
        this.scopes.getRunState(scopeId).workflowRunId,
        destinationId,
        phase,
        attemptId,
        createsRoot
      )
    );
  }
  async record(
    scopeId: string,
    reference: string,
    attemptId: string,
    outcome: Parameters<NotificationAuthorityApi['record']>[3]
  ): Promise<void> {
    return this.#call(async () => {
      const { routing } = this.#entry(scopeId, reference);
      const current = await routing.get();
      if (
        !current?.attempts.some(
          (attempt) =>
            attempt.attempt_id === attemptId &&
            attempt.execution_id === this.scopes.getRunState(scopeId).workflowRunId
        )
      )
        throw new Error('Notification attempt is not owned by this run');
      const { status, message_ts, external_conversation_id, sent_at, error, channel } = outcome;
      await routing.record(attemptId, {
        status,
        message_ts,
        external_conversation_id,
        sent_at,
        error,
        channel,
      });
    });
  }
  async claimSlackThread(
    scopeId: string,
    reference: string,
    input: Parameters<NotificationAuthorityApi['claimSlackThread']>[2]
  ): ReturnType<NotificationAuthorityApi['claimSlackThread']> {
    return this.#call(async () => {
      const entry = this.#entry(scopeId, reference);
      const routing = await entry.routing.get();
      const ownAttempt = routing?.attempts.find(
        (attempt) =>
          attempt.execution_id === this.scopes.getRunState(scopeId).workflowRunId &&
          attempt.status === 'sent' &&
          attempt.creates_root &&
          attempt.external_conversation_id === input.externalConversationId
      );
      const destination = routing?.destinations.find(({ id }) => id === ownAttempt?.destination_id);
      if (
        !ownAttempt ||
        destination?.thread?.channel !== input.channel ||
        destination.thread.thread_ts !== input.threadTs
      )
        throw new Error('Slack thread is not owned by this run');
      return this.#client(scopeId).claimSlackThread({
        investigationId: entry.investigationId,
        externalConversationId: input.externalConversationId,
        channel: input.channel,
        threadTs: input.threadTs,
      });
    });
  }
  async recordSlackThreadStatusMessage(
    scopeId: string,
    reference: string,
    input: Parameters<NotificationAuthorityApi['recordSlackThreadStatusMessage']>[2]
  ): Promise<void> {
    return this.#call(async () => {
      const entry = this.#entry(scopeId, reference);
      const routing = await entry.routing.get();
      const ownAttempt = routing?.attempts.find(
        (attempt) =>
          attempt.execution_id === this.scopes.getRunState(scopeId).workflowRunId &&
          attempt.status === 'sent' &&
          attempt.message_ts === input.messageTs
      );
      const destination = routing?.destinations.find(({ id }) => id === ownAttempt?.destination_id);
      if (
        !ownAttempt ||
        (destination?.thread?.channel ?? destination?.params.channel) !== input.channel ||
        destination?.params.thread_ts !== input.threadTs
      )
        throw new Error('Slack status message is not owned by this run');
      await this.#client(scopeId).recordSlackThreadStatusMessage({
        investigationId: entry.investigationId,
        channel: input.channel,
        threadTs: input.threadTs,
        messageTs: input.messageTs,
      });
    });
  }
  async actionsAvailable(scopeId: string, reference: string): Promise<void> {
    return this.#call(async () => {
      this.#entry(scopeId, reference);
      const actions = this.deps.getActions();
      if (!actions) throw new Error('actions plugin is not available');
      await actions.getActionsClientWithRequestInSpace(
        this.scopes.get<KibanaRequest>(scopeId),
        brandSpaceId(this.scopes.getRunState(scopeId).spaceId)
      );
    });
  }
}

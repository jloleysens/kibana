/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type {
  NotificationRoutingOperations,
  NotificationInvestigationClient,
} from '../lib/notifications/send_investigation_notifications';
export interface NotificationAuthorityApi {
  open(
    scopeId: string,
    stepId: string,
    investigationId: string
  ): Promise<{
    reference: string;
    context: Awaited<
      ReturnType<NotificationInvestigationClient['getInvestigationExecutionContext']>
    >;
    redirectUrl: string;
  }>;
  ensureFailure(scopeId: string, stepId: string, investigationId: string): Promise<void>;
  emitFailure(scopeId: string, reference: string): Promise<void>;
  get(scopeId: string, reference: string): ReturnType<NotificationRoutingOperations['get']>;
  isActive(
    scopeId: string,
    reference: string
  ): ReturnType<NotificationRoutingOperations['isActive']>;
  initialize(
    scopeId: string,
    reference: string
  ): ReturnType<NotificationRoutingOperations['initialize']>;
  selectTerminalPhase(
    scopeId: string,
    reference: string,
    phase: 'completed' | 'failed'
  ): ReturnType<NotificationRoutingOperations['selectTerminalPhase']>;
  claim(
    scopeId: string,
    reference: string,
    destinationId: string,
    phase: Parameters<NotificationRoutingOperations['claim']>[2],
    attemptId: string,
    createsRoot: boolean
  ): ReturnType<NotificationRoutingOperations['claim']>;
  record(
    scopeId: string,
    reference: string,
    attemptId: string,
    outcome: Parameters<NotificationRoutingOperations['record']>[1]
  ): Promise<void>;
  claimSlackThread(
    scopeId: string,
    reference: string,
    input: Parameters<NotificationInvestigationClient['claimSlackThread']>[0]
  ): ReturnType<NotificationInvestigationClient['claimSlackThread']>;
  recordSlackThreadStatusMessage(
    scopeId: string,
    reference: string,
    input: Parameters<NotificationInvestigationClient['recordSlackThreadStatusMessage']>[0]
  ): Promise<void>;
  actionsAvailable(scopeId: string, reference: string): Promise<void>;
}
export const NotificationAuthorityToken = createToken<NotificationAuthorityApi>(
  'nightshift.notificationAuthority'
);

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import type { WorkflowStepCatalogApi } from '@kbn/workflows-extensions/server/remote/tokens';
import type { SpecRuntime } from '@kbn/actions-plugin/server/remote/spec_runtime';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import type { ExecuteConnector } from '../lib/notifications/notification_delivery';
import { sendInvestigationNotificationsWithRuntime } from '../lib/notifications/send_investigation_notifications';
import type { NotificationRoutingOperations } from '../lib/notifications/send_investigation_notifications';
import { createSendNotificationsHandler } from './send_notifications';
import { createHandleInvestigationFailureHandler } from './handle_investigation_failure';
import type { NotificationAuthorityApi } from './notification_authority_tokens';
import { restoreInvestigationError } from './investigation_errors';

export const runNotificationStep = async (
  failure: boolean,
  authority: NotificationAuthorityApi,
  runtime: SpecRuntime,
  catalog: WorkflowStepCatalogApi,
  [scopeId, , context]: Parameters<RemoteWorkflowStep['run']>
): ReturnType<RemoteWorkflowStep['run']> => {
  const handlerContext = context.handlerContext;
  if (!handlerContext) throw new Error('Notifications require executor-local handler context');
  let opened: Awaited<ReturnType<NotificationAuthorityApi['open']>> | undefined;
  const reference = () => {
    if (!opened) throw new Error('Notification context is not open');
    return opened.reference;
  };
  const routing: NotificationRoutingOperations = {
    get: () => restoreInvestigationError(authority.get(scopeId, reference())),
    isActive: () => restoreInvestigationError(authority.isActive(scopeId, reference())),
    initialize: () => restoreInvestigationError(authority.initialize(scopeId, reference())),
    selectTerminalPhase: (_, phase) =>
      restoreInvestigationError(authority.selectTerminalPhase(scopeId, reference(), phase)),
    claim: (_, destinationId, phase, attemptId, createsRoot) =>
      restoreInvestigationError(
        authority.claim(scopeId, reference(), destinationId, phase, attemptId, createsRoot)
      ),
    record: (attemptId, outcome) =>
      restoreInvestigationError(authority.record(scopeId, reference(), attemptId, outcome)),
  };
  const send: Parameters<typeof createSendNotificationsHandler>[0]['send'] = (
    localContext,
    options
  ) =>
    sendInvestigationNotificationsWithRuntime(
      {
        getClient: () => ({
          getInvestigationExecutionContext: async (investigationId) => {
            opened = await restoreInvestigationError(
              authority.open(scopeId, handlerContext.stepId, investigationId)
            );
            return opened.context;
          },
          claimSlackThread: (input) =>
            restoreInvestigationError(authority.claimSlackThread(scopeId, reference(), input)),
          recordSlackThreadStatusMessage: (input) =>
            restoreInvestigationError(
              authority.recordSlackThreadStatusMessage(scopeId, reference(), input)
            ),
        }),
        getRoutingClient: async () => routing,
        getRedirectUrl: () => {
          if (!opened) throw new Error('Notification context is not open');
          return opened.redirectUrl;
        },
        getExecute: async () => {
          await restoreInvestigationError(authority.actionsAvailable(scopeId, reference()));
          const execute: ExecuteConnector = async (execution) =>
            (await runtime.runAction(scopeId, execution, (type, input) =>
              catalog.runConnector(type, scopeId, input, { signal: execution.signal })
            )) as Awaited<ReturnType<ExecuteConnector>>;
          return execute;
        },
      },
      localContext,
      options
    );
  recordRemoteTiming('nightshift_native_handler', {
    scopeId,
    stepType: failure ? 'handle_investigation_failure' : 'send_notifications',
  });
  if (failure) {
    const handler = createHandleInvestigationFailureHandler({
      send,
      ensureForFailure: (_, investigationId) =>
        restoreInvestigationError(
          authority.ensureFailure(scopeId, handlerContext.stepId, investigationId)
        ),
      emitFailure: () => restoreInvestigationError(authority.emitFailure(scopeId, reference())),
    });
    return handler(handlerContext as Parameters<typeof handler>[0]);
  }
  const handler = createSendNotificationsHandler({ send });
  return handler(handlerContext as Parameters<typeof handler>[0]);
};

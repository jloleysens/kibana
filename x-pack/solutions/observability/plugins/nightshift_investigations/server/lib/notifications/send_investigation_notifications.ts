/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { brandSpaceId } from '@kbn/core-spaces-common';
import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { PluginStartContract as ActionsPluginStart } from '@kbn/actions-plugin/server';
import type { KibanaRequest, Logger } from '@kbn/core/server';
import type { NotificationPhase } from './notification_routing';
import { repliesUnderCallerMessage } from './replies_under_caller_message';
import type { NotificationRoutingClient } from './notification_routing_client';
import type { ExecuteConnector } from './notification_delivery';
import type { InvestigationLocator } from '../../../common/locators';
import type { GetInvestigationsClient } from '../../routes/types';
import { ELASTIC_APPS_SLACK_CONNECTOR_ID } from '../../../common/notification_constants';
import {
  deliverInvestigationNotifications,
  getSentMessageTs,
  getStartedMessageTs,
} from './deliver_investigation_notifications';
import type { DeliverInvestigationNotificationsResult } from './deliver_investigation_notifications';

export interface InvestigationNotificationDeps {
  investigationLocator: Pick<InvestigationLocator, 'getRedirectUrl'>;
  getInvestigationsClient: GetInvestigationsClient;
  getActions: () => ActionsPluginStart | undefined;
  getRoutingClient: (
    request: KibanaRequest,
    spaceId: string,
    conversationId: string,
    investigationId: string
  ) => Promise<NotificationRoutingClient>;
}

export type NotificationRoutingOperations = Pick<
  NotificationRoutingClient,
  'get' | 'isActive' | 'initialize' | 'selectTerminalPhase' | 'claim' | 'record'
>;
export type NotificationInvestigationClient = Pick<
  ReturnType<GetInvestigationsClient>,
  'getInvestigationExecutionContext' | 'claimSlackThread' | 'recordSlackThreadStatusMessage'
>;
export interface InvestigationNotificationRuntime {
  getClient: (spaceId: string) => NotificationInvestigationClient;
  getRoutingClient: (
    spaceId: string,
    conversationId: string,
    investigationId: string
  ) => Promise<NotificationRoutingOperations>;
  getRedirectUrl: (investigationId: string, spaceId: string) => string;
  getExecute: (spaceId: string) => Promise<ExecuteConnector>;
}

/** Adapts the original scoped plugin dependencies without changing delivery scheduling. */
export const sendInvestigationNotifications = async (
  deps: InvestigationNotificationDeps,
  context: Parameters<typeof sendInvestigationNotificationsWithRuntime>[1],
  options: Parameters<typeof sendInvestigationNotificationsWithRuntime>[2]
): ReturnType<typeof sendInvestigationNotificationsWithRuntime> => {
  const request = context.contextManager.getFakeRequest();
  return sendInvestigationNotificationsWithRuntime(
    {
      getClient: (spaceId) => deps.getInvestigationsClient(request, spaceId),
      getRoutingClient: (spaceId, conversationId, investigationId) =>
        deps.getRoutingClient(request, spaceId, conversationId, investigationId),
      getRedirectUrl: (investigationId, spaceId) =>
        deps.investigationLocator.getRedirectUrl({ investigationId }, { spaceId }),
      getExecute: async (spaceId) => {
        const actions = deps.getActions();
        if (!actions) throw new Error('actions plugin is not available');
        const actionsClient = await actions.getActionsClientWithRequestInSpace(
          request,
          brandSpaceId(spaceId)
        );
        return (execution) => actionsClient.execute(execution);
      },
    },
    context,
    options
  );
};

/** Sends a lifecycle phase using the workflow's authenticated request and persisted routing. */
export const sendInvestigationNotificationsWithRuntime = async (
  runtime: InvestigationNotificationRuntime,
  context: Pick<StepHandlerContext, 'contextManager' | 'logger' | 'abortSignal'>,
  {
    investigationId,
    phase,
    reason,
    onTerminalPhaseSelected,
  }: {
    investigationId: string;
    phase: NotificationPhase;
    reason?: string;
    onTerminalPhaseSelected?: () => Promise<void>;
  }
): Promise<DeliverInvestigationNotificationsResult> => {
  const {
    kibanaUrl,
    execution: { id: executionId },
    workflow: { spaceId },
  } = context.contextManager.getContext();
  const client = runtime.getClient(spaceId);
  const { investigation, conversationId, workflowId, notificationDestinations } =
    await client.getInvestigationExecutionContext(investigationId, executionId);
  const routingClient = await runtime.getRoutingClient(spaceId, conversationId, investigationId);
  // Without server.publicBaseUrl, the server locator returns a relative URL.
  const result = await deliverInvestigationNotifications({
    investigation,
    executionId,
    workflowId,
    notificationDestinations,
    phase,
    reason,
    routingClient,
    investigationUrl: new URL(
      runtime.getRedirectUrl(investigationId, spaceId),
      kibanaUrl
    ).toString(),
    logger: context.logger,
    getExecute: () => runtime.getExecute(spaceId),
    signal: context.abortSignal,
    onTerminalPhaseSelected,
  });
  await recordSlackThreadStatusMessages({
    client,
    routingClient,
    investigationId,
    executionId,
    phase,
    logger: context.logger,
  });
  await claimRootSlackThreads({
    client,
    routingClient,
    investigationId,
    executionId,
    logger: context.logger,
  });
  return result;
};

/**
 * Claims each Slack thread this run's root post started, so a mention or reply in it reaches the
 * investigation. Only the Elastic app's posts carry the thread key. A failure is logged rather
 * than thrown: the post is already delivered and recorded.
 */
const claimRootSlackThreads = async ({
  client,
  routingClient,
  investigationId,
  executionId,
  logger,
}: {
  client: NotificationInvestigationClient;
  routingClient: NotificationRoutingOperations;
  investigationId: string;
  executionId: string;
  logger: Pick<Logger, 'warn'>;
}): Promise<void> => {
  const routing = await routingClient.get().catch((error: unknown) => {
    logger.warn(
      `Could not read notification routing to claim Slack threads for investigation "${investigationId}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  });
  if (!routing) {
    return;
  }
  for (const destination of routing.destinations) {
    if (
      destination.type !== 'slack' ||
      destination.connector_id !== ELASTIC_APPS_SLACK_CONNECTOR_ID ||
      repliesUnderCallerMessage(destination) ||
      !destination.thread
    ) {
      continue;
    }
    const rootPost = routing.attempts.find(
      (attempt) =>
        attempt.execution_id === executionId &&
        attempt.destination_id === destination.id &&
        attempt.creates_root &&
        attempt.status === 'sent' &&
        attempt.external_conversation_id
    );
    if (!rootPost?.external_conversation_id) {
      continue;
    }
    try {
      await client.claimSlackThread({
        investigationId,
        externalConversationId: rootPost.external_conversation_id,
        channel: destination.thread.channel,
        threadTs: destination.thread.thread_ts,
      });
    } catch (error) {
      logger.warn(
        `Could not claim the Slack thread for investigation "${investigationId}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

/**
 * Hands the message this run keeps under the caller's Slack message to the Slack thread workflow,
 * which edits it for every reply instead of posting its own. That is the started message, or the
 * message a later phase posted when the started one was not confirmed. A failure is logged rather
 * than thrown: the message is already posted and recorded, and the thread workflow posts its own
 * message when none is recorded.
 */
const recordSlackThreadStatusMessages = async ({
  client,
  routingClient,
  investigationId,
  executionId,
  phase,
  logger,
}: {
  client: NotificationInvestigationClient;
  routingClient: NotificationRoutingOperations;
  investigationId: string;
  executionId: string;
  phase: NotificationPhase;
  logger: Pick<Logger, 'warn'>;
}): Promise<void> => {
  try {
    const routing = await routingClient.get();
    if (!routing) {
      return;
    }
    for (const destination of routing.destinations) {
      if (
        destination.type !== 'slack' ||
        destination.connector_id !== ELASTIC_APPS_SLACK_CONNECTOR_ID
      ) {
        continue;
      }
      // A later phase edits a confirmed started message, which was already handed off.
      const messageTs =
        phase === 'started' || !getStartedMessageTs(routing, executionId, destination)
          ? getSentMessageTs(routing, executionId, destination, phase)
          : undefined;
      const channel = destination.thread?.channel ?? destination.params.channel;
      const threadTs = destination.params.thread_ts;
      if (messageTs && typeof channel === 'string' && typeof threadTs === 'string') {
        await client.recordSlackThreadStatusMessage({
          investigationId,
          channel,
          threadTs,
          messageTs,
        });
      }
    }
  } catch (error) {
    logger.warn(
      `Could not record the Slack thread status message for investigation "${investigationId}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

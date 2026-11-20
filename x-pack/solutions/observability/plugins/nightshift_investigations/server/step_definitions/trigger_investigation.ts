/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { StepCategory } from '@kbn/workflows-runtime';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server/step_registry/types';
import type { PluginStartContract as ActionsPluginStart } from '@kbn/actions-plugin/server';
import type { NightshiftSettingsLocator } from '../../common/locators';
import { inputSchema, outputSchema } from '../remote/trigger_investigation_schema';
import type {
  GetAlertsClient,
  GetAutomationsSoClient,
  GetEpisodeLookup,
  GetInvestigationsClient,
} from '../routes/types';
import { createTriggerInvestigationHandler } from '../remote/trigger_investigation';
import { createInvestigationDispatchOperations } from '../remote/investigation_dispatch_operations';

export const triggerInvestigationStepDefinition = (
  getInvestigationsClient: GetInvestigationsClient,
  getAutomationsSoClient: GetAutomationsSoClient,
  getAlertsClient: GetAlertsClient,
  getEpisodeLookup: GetEpisodeLookup,
  getActions: () => ActionsPluginStart | undefined,
  settingsLocator: NightshiftSettingsLocator
) => {
  const operations = createInvestigationDispatchOperations({
    getInvestigationsClient,
    getAutomationsSoClient,
    getAlertsClient,
    getEpisodeLookup,
    getActions,
    settingsLocator,
  });
  return createServerStepDefinition({
    id: 'nightshift.triggerInvestigation',
    label: 'Trigger Nightshift Investigation',
    category: StepCategory.Ai,
    description:
      'Start an investigation for a given subject (significant event, alert, or other entity). When the subject, or any alert in context.alerts, is already part of an open investigation, that investigation continues instead. Returns investigation_id for tracking, or skip_reason when the automation daily limit or the deployment-wide investigation limit is reached.',
    inputSchema,
    outputSchema,
    handler: createTriggerInvestigationHandler({
      prepare: (context, automationId) =>
        operations.prepare(
          context.contextManager.getFakeRequest(),
          context.contextManager.getContext().workflow.spaceId,
          context.contextManager.getContext().workflow.id,
          automationId
        ),
      resolveAlerts: (context, subjectId) =>
        operations.resolveAlerts(
          context.contextManager.getFakeRequest(),
          context.contextManager.getContext().workflow.spaceId,
          subjectId
        ),
      start: (reference, input) => operations.start(reference, input),
      notifyQuota: (context, slackThread) =>
        operations.notifyQuota(
          context.contextManager.getFakeRequest(),
          context.contextManager.getContext().workflow.spaceId,
          context.contextManager.getContext().kibanaUrl,
          context.abortSignal,
          context.logger,
          slackThread
        ),
    }),
  });
};

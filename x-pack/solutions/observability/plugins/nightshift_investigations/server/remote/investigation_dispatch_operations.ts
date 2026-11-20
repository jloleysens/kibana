/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { serverUnavailable } from '@hapi/boom';
import type { KibanaRequest, Logger } from '@kbn/core/server';
import type { PluginStartContract as ActionsPluginStart } from '@kbn/actions-plugin/server';
import type { NightshiftSettingsLocator } from '../../common/locators';
import type {
  GetInvestigationsClient,
  GetAutomationsSoClient,
  GetAlertsClient,
  GetEpisodeLookup,
} from '../routes/types';
import { fetchInvestigationAlertSnapshots } from '../lib/alert_snapshot';
import { NIGHTSHIFT_AUTOMATION_SO_TYPE } from '../saved_objects/automation_saved_object';
import type { NightshiftAutomationAttributes } from '../lib/automations/types';
import { createAutomationBudget } from '../lib/automations/automation_budget';
import type { AutomationBudget } from '../types';
import { notifyInvestigationQuotaReached } from '../lib/notifications/notify_investigation_quota_reached';
import type { InvestigationDispatchDeps } from './trigger_investigation';

type DispatchClient = ReturnType<GetInvestigationsClient>;
export interface PreparedInvestigationDispatch {
  client: Pick<DispatchClient, 'start'>;
  automationBudget?: AutomationBudget;
}

export const createInvestigationDispatchOperations = ({
  getInvestigationsClient,
  getAutomationsSoClient,
  getAlertsClient,
  getEpisodeLookup,
  getActions,
  settingsLocator,
}: {
  getInvestigationsClient: GetInvestigationsClient;
  getAutomationsSoClient: GetAutomationsSoClient;
  getAlertsClient: GetAlertsClient;
  getEpisodeLookup: GetEpisodeLookup;
  getActions: () => ActionsPluginStart | undefined;
  settingsLocator: NightshiftSettingsLocator;
}) => ({
  prepare: async (
    request: KibanaRequest,
    spaceId: string,
    workflowId: string,
    automationId?: string
  ): Promise<PreparedInvestigationDispatch> => {
    let automationBudget: AutomationBudget | undefined;
    if (automationId) {
      const soClient = getAutomationsSoClient(request, spaceId);
      const automation = await soClient.get<NightshiftAutomationAttributes>(
        NIGHTSHIFT_AUTOMATION_SO_TYPE,
        automationId
      );
      if (automation.attributes.workflowId !== workflowId)
        throw new Error('The automation does not belong to this workflow.');
      automationBudget = createAutomationBudget(
        soClient,
        automationId,
        automation.attributes.runtime.dailyDispatchLimit
      );
    }
    return { client: getInvestigationsClient(request, spaceId), automationBudget };
  },
  resolveAlerts: async (request: KibanaRequest, spaceId: string, subjectId: string) => {
    const alertsClient = await getAlertsClient(request);
    if (!alertsClient) throw serverUnavailable('Alert lookup is unavailable');
    return fetchInvestigationAlertSnapshots({
      alertsClient,
      alertIds: [subjectId],
      ...getEpisodeLookup(request, spaceId),
    });
  },
  start: (
    { client, automationBudget }: PreparedInvestigationDispatch,
    input: Parameters<DispatchClient['start']>[0]
  ) => client.start(input, { automationBudget }),
  notifyQuota: (
    request: KibanaRequest,
    spaceId: string,
    kibanaUrl: string,
    signal: AbortSignal,
    logger: Pick<Logger, 'warn'>,
    slackThread: Parameters<
      InvestigationDispatchDeps<PreparedInvestigationDispatch>['notifyQuota']
    >[1]
  ) =>
    notifyInvestigationQuotaReached({
      getSoClient: () => getAutomationsSoClient(request, spaceId),
      getActions,
      request,
      spaceId,
      slackThread,
      settingsLocator,
      kibanaUrl,
      signal,
      logger,
    }),
});

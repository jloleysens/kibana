/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AnalyticsServiceSetup, CoreStart, KibanaRequest, Logger } from '@kbn/core/server';
import type { IEventLogger } from '@kbn/event-log-plugin/server';
import type { WorkflowsServerPluginSetup } from '@kbn/workflows-management-plugin/server';
import { v4 as uuidv4 } from 'uuid';
import { executeGenerationWorkflow } from '@kbn/discoveries/impl/attack_discovery/generation/execute_generation_workflow';
import type { ExecuteGenerationWorkflowParams } from '@kbn/discoveries/impl/attack_discovery/generation/types';
import { getSpaceId } from '@kbn/discoveries/impl/lib/helpers/get_space_id';
import { getAlertsIndexForSpace } from '../../../lib/get_alerts_index_for_space';
import { isWorkflowsEnabledForSpace } from '../../../lib/is_workflows_enabled_for_space';
import type { DiscoveriesPluginStartDeps } from '../../../types';
import { resolveConnectorDetails } from '../../helpers/resolve_connector_details';
import { resolveDefaultConnectorId } from '../../helpers/resolve_default_connector_id';
import { checkManagedWorkflowIntegrity } from '../../../managed_workflows/check_managed_workflow_integrity';

export type RunExecutionInput = Pick<
  ExecuteGenerationWorkflowParams,
  'alerts' | 'end' | 'filter' | 'size' | 'start' | 'workflowConfig'
>;
export type RunOutcome = Awaited<ReturnType<typeof executeGenerationWorkflow>>;
export interface PreparedRun {
  executionUuid: string;
  effectiveConnectorId: string;
  execute(input: RunExecutionInput): Promise<RunOutcome>;
  launch(
    input: RunExecutionInput,
    onSettled?: () => void,
    adopt?: <T>(work: () => Promise<T>) => Promise<T>
  ): Promise<void>;
}
export interface RunDependencies {
  analytics?: AnalyticsServiceSetup;
  getEventLogIndex(): Promise<string>;
  getEventLogger(): Promise<IEventLogger>;
  getStartServices(): Promise<{ coreStart: CoreStart; pluginsStart: DiscoveriesPluginStartDeps }>;
  logger: Logger;
  workflowsManagementApi?: WorkflowsServerPluginSetup['management'];
}
export const prepareRun = async (
  { connectorId, featureId }: { connectorId?: string; featureId?: string | string[] },
  request: KibanaRequest,
  abortSignal: AbortSignal | undefined,
  {
    analytics,
    getEventLogIndex,
    getEventLogger,
    getStartServices,
    logger,
    workflowsManagementApi,
  }: RunDependencies
): Promise<PreparedRun> => {
  const executionUuid = uuidv4();
  const { coreStart, pluginsStart } = await getStartServices();

  const uiSettingsClient = coreStart.uiSettings.asScopedToClient(
    coreStart.savedObjects.getScopedClient(request)
  );

  if (
    !(await isWorkflowsEnabledForSpace({
      featureFlags: coreStart.featureFlags,
      uiSettingsClient,
    }))
  ) {
    throw new Error('Attack Discovery workflows are not enabled for this space');
  }

  // Resolve the space from the (space-scoped) fake request the same way
  // `executeGenerationWorkflow` does for its authorization guard, so the
  // alerts index is bounded to the schedule's space rather than `-default`.
  const spaceId = getSpaceId({
    request,
    spaces: pluginsStart.spaces?.spacesService,
  });

  const actionsClient = await pluginsStart.actions.getActionsClientWithRequest(request);

  const effectiveConnectorId = connectorId
    ? connectorId
    : await resolveDefaultConnectorId({
        featureId,
        inference: pluginsStart.inference,
        logger,
        request,
        searchInferenceEndpoints: pluginsStart.searchInferenceEndpoints,
        uiSettingsClient,
      });

  const getExecuteParams = async (input: RunExecutionInput) => {
    const { actionTypeId } = await resolveConnectorDetails({
      actionsClient,
      connectorId: effectiveConnectorId,
      inference: pluginsStart.inference,
      logger,
      request,
    });

    const apiConfig = {
      action_type_id: actionTypeId,
      connector_id: effectiveConnectorId,
    };
    const executeParams = {
      ...(input.alerts != null && input.alerts.length > 0 ? { alerts: input.alerts } : {}),
      alertsIndexPattern: getAlertsIndexForSpace(spaceId),
      analytics,
      apiConfig,
      authz: pluginsStart.security.authz,
      checkIntegrity:
        workflowsManagementApi != null
          ? async ({
              logger: checkLogger,
              spaceId: checkSpaceId,
            }: {
              logger: Logger;
              spaceId: string;
            }) => {
              const { pluginsStart: startDeps } = await getStartServices();
              return checkManagedWorkflowIntegrity({
                analytics,
                logger: checkLogger,
                spaceId: checkSpaceId,
                workflowsExtensions: startDeps.workflowsExtensions,
              });
            }
          : undefined,
      end: input.end,
      executionUuid,
      filter: input.filter,
      getEventLogIndex,
      getEventLogger,
      getStartServices: async () => {
        const services = await getStartServices();
        return {
          coreStart: services.coreStart,
          pluginsStart: services.pluginsStart as unknown,
        };
      },
      logger,
      request,
      // Forward the step's cancellation as the pipeline's stop probe. The
      // engine aborts this signal when the step (or the enclosing parallel
      // branch) times out, but the pipeline is a plain `await` that is not
      // otherwise tied to it — without this it keeps making inference calls
      // after the step has already been marked failed.
      shouldStopExecution: () => abortSignal?.aborted === true,
      size: input.size,
      start: input.start,
      trigger: 'workflow',
      type: 'attack_discovery',
      workflowConfig: input.workflowConfig,
      workflowsManagementApi,
    };

    return executeParams;
  };
  return {
    executionUuid,
    effectiveConnectorId,
    execute: async (input) => executeGenerationWorkflow(await getExecuteParams(input)),
    launch: async (input, onSettled, adopt) => {
      const executeParams = await getExecuteParams(input);
      const pipeline = adopt
        ? adopt(() => executeGenerationWorkflow(executeParams))
        : executeGenerationWorkflow(executeParams);
      void pipeline
        .catch((err) => {
          logger.error(
            `Async Attack Discovery run failed (execution=${executionUuid}): ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        })
        .finally(onSettled);
    },
  };
};

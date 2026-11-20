/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { WorkflowConfig } from '@kbn/discoveries/impl/attack_discovery/generation/types';
import type { RunStepInputSchema } from '../../../../common/step_types/run_step';
import type { PreparedRun } from './prepare_run';
export type RunContext = StepHandlerContext<typeof RunStepInputSchema>;
export const createRunHandler =
  (
    prepare: (
      input: { connectorId?: string; featureId?: string | string[] },
      context: RunContext
    ) => Promise<PreparedRun>
  ) =>
  async (context: RunContext) => {
    try {
      // The workflow engine does NOT apply the step schema's zod `.default()`
      // values to `context.input`, so defaulted fields arrive `undefined` when
      // the caller omits them. Mirror the `RunStepInputSchema` defaults here so
      // the documented "all inputs optional" contract holds for every path.
      const {
        additional_context: additionalContext,
        alert_retrieval_mode: alertRetrievalMode = 'custom_query',
        alert_retrieval_workflow_ids: alertRetrievalWorkflowIds = [],
        alerts,
        connector_id: connectorId,
        end,
        esql_query: esqlQuery,
        feature_id: featureId,
        filter,
        ground_truth_gate_enabled: groundTruthGateEnabled = true,
        // The engine does not apply the schema's zod defaults to
        // `context.input`, so the default is mirrored here (see the note above).
        include_attack_discoveries: includeAttackDiscoveries = true,
        mode = 'sync',
        size = 100,
        start,
        validation_workflow_id: validationWorkflowId = '',
      } = context.input;

      const prepared = await prepare({ connectorId, featureId }, context);
      const { executionUuid, effectiveConnectorId } = prepared;

      context.logger.info(
        `Starting Attack Discovery run step (mode=${mode}, connector=${effectiveConnectorId})`
      );

      // Pre-supplied alerts are passed directly via `executeParams.alerts`, so
      // the retrieval phase is skipped; otherwise the legacy run-step input
      // enum is bridged to the composite toggles (legacy `custom_only` =>
      // default retrieval off).
      const hasProvidedAlerts = alerts != null && alerts.length > 0;
      const queryMode = alertRetrievalMode === 'esql' ? 'esql' : 'custom_query';

      const workflowConfig: WorkflowConfig = {
        ...(additionalContext != null ? { additional_context: additionalContext } : {}),
        alert_retrieval_mode: queryMode,
        alert_retrieval_workflow_ids: alertRetrievalWorkflowIds,
        alert_retrieval_workflows_enabled: alertRetrievalWorkflowIds.length > 0,
        default_retrieval_enabled: !hasProvidedAlerts && alertRetrievalMode !== 'custom_only',
        ...(esqlQuery != null ? { esql_query: esqlQuery } : {}),
        ground_truth_gate_enabled: groundTruthGateEnabled,
        // The skill's additional retrieval runs inside the gate, so it is off
        // with the gate. That also keeps the "no alert source" check strict.
        skill_enabled: groundTruthGateEnabled,
        validation_workflow_id: validationWorkflowId,
      };

      const executeInput = { alerts, end, filter, size, start, workflowConfig };

      if (mode === 'async') {
        await prepared.launch(executeInput);

        return {
          output: {
            execution_uuid: executionUuid,
            status: 'pending' as const,
          },
        };
      }

      // sync mode (the default): await the pipeline to completion and return
      // the discoveries inline. The step's own `timeout` bounds the wait for a
      // slow generation. The Agent Builder run tool needs to stay under its
      // 120s wrapper ceiling and applies its own soft deadline separately — it
      // does not use this step, so no soft deadline is applied here.
      const outcome = await prepared.execute(executeInput);

      if (outcome.outcome === 'validation_succeeded') {
        const { alertRetrievalResult, generationResult, validationResult } = outcome;

        return {
          output: {
            alerts_context_count: alertRetrievalResult.alertsContextCount,
            // R3: the run step persists via the persist step and returns exactly the
            // discoveries it was handed (`[]` when the persist step did not run).
            // Omitted entirely — not nulled — when the caller opts out, so the
            // output carries none of their weight.
            ...(includeAttackDiscoveries
              ? {
                  attack_discoveries: (validationResult.discoveriesToPersist ?? []) as Array<{
                    alert_ids: string[];
                    details_markdown: string;
                    entity_summary_markdown?: string;
                    id?: string;
                    mitre_attack_tactics?: string[];
                    summary_markdown: string;
                    timestamp?: string;
                    title: string;
                  }>,
                }
              : {}),
            discovery_count: validationResult.generatedCount,
            execution_uuid: generationResult.executionUuid,
            status: 'completed' as const,
          },
        };
      }

      context.logger.warn(`Attack Discovery validation failed (execution=${executionUuid})`);

      return {
        output: {
          alerts_context_count: 0,
          ...(includeAttackDiscoveries ? { attack_discoveries: null } : {}),
          discovery_count: 0,
          execution_uuid: executionUuid,
          status: 'completed' as const,
        },
      };
    } catch (error) {
      context.logger.error(
        `Attack Discovery run step failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        error instanceof Error ? error : undefined
      );

      return {
        error: new Error(
          error instanceof Error ? error.message : 'Attack Discovery run step failed'
        ),
      };
    }
  };

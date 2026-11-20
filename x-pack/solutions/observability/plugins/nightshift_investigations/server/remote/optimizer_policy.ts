/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AnalyticsServiceSetup, KibanaRequest, Logger } from '@kbn/core/server';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { remotable } from '@kbn/core-remote-common';
import type { createModelObservations } from '@kbn/agent-builder-plugin/server/remote/model_observations';
import {
  createInvestigationMemoryTelemetry,
  resolveOptimizeConnector,
} from '../lib/create_optimize_model';
import { createCortexTelemetry } from '../telemetry/cortex_telemetry';
import type { NightshiftTelemetryClient } from '../telemetry/client';
import type { OptimizerPolicyApi } from './optimizer_policy_tokens';
import { createInvestigationTransportError } from './investigation_errors';

type ModelDeps = Omit<
  Parameters<typeof resolveOptimizeConnector>[0],
  'request' | 'requestedConnectorId' | 'roundConnectorId' | 'logger'
>;
@remotable()
export class OptimizerPolicy implements OptimizerPolicyApi {
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly getModelDeps: () => ModelDeps,
    private readonly observations: ReturnType<typeof createModelObservations>,
    private readonly flags: () => { cortex: boolean; memory: boolean },
    private readonly analytics: AnalyticsServiceSetup,
    private readonly telemetry: Pick<NightshiftTelemetryClient, 'reportSemanticMemoryOptimized'>,
    private readonly loggers: { cortex: Logger; memory: Logger }
  ) {}
  async open(
    ...args: Parameters<OptimizerPolicyApi['open']>
  ): ReturnType<OptimizerPolicyApi['open']> {
    return this.observations.api.open(...args);
  }
  async report(...args: Parameters<OptimizerPolicyApi['report']>): Promise<void> {
    return this.observations.api.report(...args);
  }
  async settle(...args: Parameters<OptimizerPolicyApi['settle']>): Promise<void> {
    return this.observations.api.settle(...args);
  }
  #type(scopeId: string, stepId: string): 'cortex' | 'memory' {
    this.scopes.getAbortSignal(scopeId).throwIfAborted();
    this.scopes.getRunState(scopeId);
    const stepType = this.scopes.resolveStepType(scopeId, stepId);
    if (stepType === 'nightshift.cortexOptimize') return 'cortex';
    if (stepType === 'nightshift.memoryOptimize') return 'memory';
    throw new Error('Unknown optimizer step');
  }
  async log(
    scopeId: string,
    stepId: string,
    level: Parameters<OptimizerPolicyApi['log']>[2],
    message: string
  ): Promise<void> {
    const kind = this.#type(scopeId, stepId);
    if (!['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(level))
      throw new Error('Unknown optimizer log level');
    this.loggers[kind][level](message);
  }
  async enabled(scopeId: string, stepId: string): Promise<boolean> {
    return this.flags()[this.#type(scopeId, stepId)];
  }
  async prepareModel(
    scopeId: string,
    stepId: string,
    input: Parameters<OptimizerPolicyApi['prepareModel']>[2]
  ): Promise<string | undefined> {
    try {
      const kind = this.#type(scopeId, stepId);
      const request = this.scopes.get<KibanaRequest>(scopeId);
      const { workflowRunId } = this.scopes.getRunState(scopeId);
      const deps = this.getModelDeps();
      const { requestedConnectorId, roundConnectorId } = input;
      const connectorId = await resolveOptimizeConnector({
        ...deps,
        request,
        requestedConnectorId,
        roundConnectorId,
        logger: this.loggers[kind],
      });
      if (!connectorId || !deps.agentBuilder) return undefined;
      const observation = await deps.agentBuilder.runtime.issueModelObservation({
        request,
        connectorId,
        metadata: createInvestigationMemoryTelemetry(workflowRunId),
      });
      this.observations.issue(scopeId, stepId, connectorId, observation);
      return connectorId;
    } catch (error) {
      throw createInvestigationTransportError(error);
    }
  }
  async reportCortex(
    scopeId: string,
    stepId: string,
    input: Parameters<OptimizerPolicyApi['reportCortex']>[2]
  ): Promise<void> {
    const kind = this.#type(scopeId, stepId);
    if (kind !== 'cortex') throw new Error('Not a Cortex optimizer');
    const { conversationId, roundId, edits } = input;
    createCortexTelemetry({
      analytics: this.analytics,
      conversationId,
      roundId,
      logger: this.loggers[kind],
    }).reportEditsApplied(edits.map(({ action, entityType }) => ({ action, entityType })));
  }
  async reportMemory(
    scopeId: string,
    stepId: string,
    event: Parameters<OptimizerPolicyApi['reportMemory']>[2]
  ): Promise<void> {
    if (this.#type(scopeId, stepId) !== 'memory') throw new Error('Not a Memory optimizer');
    const {
      agent_id,
      conversation_id,
      round_id,
      outcome,
      recalled_count,
      loaded_count,
      useful_count,
      harmful_count,
      extraction_proposed_count,
      standalone_upsert_count,
      safety_skip_count,
      merge_attempt_count,
      merge_success_count,
      harmful_archive_count,
      merged_source_archive_count,
      write_failure_count,
    } = event;
    this.telemetry.reportSemanticMemoryOptimized({
      agent_id,
      conversation_id,
      round_id,
      outcome,
      recalled_count,
      loaded_count,
      useful_count,
      harmful_count,
      extraction_proposed_count,
      standalone_upsert_count,
      safety_skip_count,
      merge_attempt_count,
      merge_success_count,
      harmful_archive_count,
      merged_source_archive_count,
      write_failure_count,
      workflow_execution_id: this.scopes.getRunState(scopeId).workflowRunId,
    });
  }
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import type { Logger } from '@kbn/core/server';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { recordRemoteTiming } from '@kbn/core-remote-common';
import { createModelProviderRuntime } from '@kbn/agent-builder-plugin/server/services/execution/runner/model_provider_runtime';
import {
  ConversationRegistryToken,
  type ConversationRegistryApi,
} from '@kbn/agent-builder-plugin/server/remote/conversation_tokens';
import type { createNativeConversation } from '@kbn/agent-builder-plugin/server/remote/native_conversation';
import {
  InferencePolicyToken,
  type InferencePolicyApi,
} from '@kbn/inference-plugin/server/remote/tokens';
import {
  InferenceFeaturesToken,
  type InferenceFeaturesApi,
} from '@kbn/search-inference-endpoints/server/remote/tokens';
import {
  ConversationDataPlaneToken as WorkflowDataPlaneToken,
  type ConversationDataPlane,
} from '@kbn/agent-builder-plugin/server/remote/conversation_tokens';
import type { LocalConnectorExecution } from '@kbn/actions-plugin/server/remote/local_execution';
import { executeLegacyInferenceAction } from '@kbn/stack-connectors-plugin/server/remote/execute_inference_action';
import type { ConnectorDataPlane } from '@kbn/stack-connectors-plugin/server/remote/tokens';
import { SpecRuntimeToken } from '@kbn/actions-plugin/server/remote/tokens';
import type { SpecRuntime } from '@kbn/actions-plugin/server/remote/spec_runtime';
import { loadInvestigationRound } from '../investigation_round/round_loader';
import { loadRoundSteps } from '../memory/load_round_steps';
import { runCortexOptimize } from '../cortex/run_optimize';
import { runMemoryOptimize } from '../memory/run_optimize';
import { loadOptimizeModel } from '../lib/load_optimize_model';
import { createCortexOptimizeHandler } from './cortex_optimize';
import { createMemoryOptimizeHandler } from './memory_optimize';
import { OptimizerPolicyToken, type OptimizerPolicyApi } from './optimizer_policy_tokens';
import { restoreInvestigationError } from './investigation_errors';

type RunArgs = Parameters<RemoteWorkflowStep['run']>;
export class OptimizerStep {
  constructor(
    @inject(OptimizerPolicyToken) protected readonly policy: OptimizerPolicyApi,
    @inject(ConversationRegistryToken) protected readonly registry: ConversationRegistryApi,
    @inject(InferencePolicyToken) protected readonly inferencePolicy: InferencePolicyApi,
    @inject(InferenceFeaturesToken) protected readonly features: InferenceFeaturesApi,
    @inject(WorkflowDataPlaneToken)
    protected readonly data: ConversationDataPlane & ConnectorDataPlane,
    @inject(SpecRuntimeToken) protected readonly connectors: SpecRuntime
  ) {}
  protected async optimize(
    kind: 'cortex' | 'memory',
    [scopeId, , context]: RunArgs
  ): ReturnType<RemoteWorkflowStep['run']> {
    const handlerContext = context.handlerContext;
    if (!handlerContext) throw new Error('Optimizer requires executor-local handler context');
    const { stepId } = handlerContext;
    const enabled = await this.policy.enabled(scopeId, stepId);
    const reporting: Array<Promise<void>> = [];
    const report = (pending: Promise<void>) => {
      reporting.push(
        pending.catch(() => handlerContext.logger.debug('Optimizer telemetry reporting failed'))
      );
    };
    const logger: Logger = {
      get: () => logger,
      log: (record) => report(this.policy.log(scopeId, stepId, 'debug', String(record.message))),
      trace: (message) => report(this.policy.log(scopeId, stepId, 'trace', String(message))),
      debug: (message) => report(this.policy.log(scopeId, stepId, 'debug', String(message))),
      info: (message) => report(this.policy.log(scopeId, stepId, 'info', String(message))),
      warn: (message) => report(this.policy.log(scopeId, stepId, 'warn', String(message))),
      error: (message) => report(this.policy.log(scopeId, stepId, 'error', String(message))),
      fatal: (message) => report(this.policy.log(scopeId, stepId, 'fatal', String(message))),
      isLevelEnabled: () => true,
    };
    let native: ReturnType<typeof createNativeConversation> | undefined;
    const getConversationClient = async () => {
      native ??= import('@kbn/agent-builder-plugin/server/remote/native_conversation').then(
        ({ createNativeConversation: create }) =>
          create({
            scopeId,
            registry: this.registry,
            esClient: this.data.internal(scopeId),
            logger,
          })
      );
      return (await native).client;
    };
    const localExecutions: LocalConnectorExecution[] = [];
    const createModel = async (input: {
      requestedConnectorId?: string;
      roundConnectorId?: string;
    }) => {
      const connectorId = await restoreInvestigationError(
        this.policy.prepareModel(scopeId, stepId, {
          requestedConnectorId: input.requestedConnectorId,
          roundConnectorId: input.roundConnectorId,
        })
      );
      if (!connectorId) return undefined;
      const policy = await this.inferencePolicy.read(scopeId);
      if (!policy)
        throw new Error('Optimizer inference policy is not available for native execution');
      const { createWorkerInference } = await import(
        '@kbn/inference-plugin/server/remote/worker_inference'
      );
      const inference = createWorkerInference({
        scopeId,
        policy,
        capability: this.inferencePolicy,
        internalClient: this.data.internal(scopeId),
        userClient: this.data.user(scopeId),
        logger,
        executeAction: async (options) => {
          const execution = await executeLegacyInferenceAction({
            options,
            runtime: this.connectors,
            data: this.data,
            scopeId,
            signal: handlerContext.abortSignal,
          });
          localExecutions.push(execution);
          return execution.result;
        },
      });
      const features = await this.features.list(scopeId);
      const searchInferenceEndpoints = {
        features: { get: (id: string) => features.find(({ featureId }) => id === featureId) },
        endpoints: {
          getForFeature: (
            id: string,
            _request: object,
            options?: { onlyReturnConfigured?: boolean }
          ) => this.features.getForFeature(scopeId, id, options),
        },
      };
      const first = await this.policy.open(scopeId, stepId, connectorId);
      let lease: string | undefined = first.lease;
      const modelProvider = createModelProviderRuntime({
        request: handlerContext.contextManager.getFakeRequest(),
        inference: inference as Parameters<typeof createModelProviderRuntime>[0]['inference'],
        searchInferenceEndpoints: searchInferenceEndpoints as Parameters<
          typeof createModelProviderRuntime
        >[0]['searchInferenceEndpoints'],
        defaultConnectorId: connectorId,
        logger,
        resolveTelemetryMetadata: async () => first.metadata,
        observeCompletion: (event) => {
          const current = lease;
          lease = undefined;
          report(
            (async () => {
              const reference =
                current ?? (await this.policy.open(scopeId, stepId, connectorId)).lease;
              await this.policy.report(scopeId, reference, {
                model: event.model,
                tokens: event.tokens,
              });
            })()
          );
        },
      });
      return loadOptimizeModel(modelProvider, connectorId, logger);
    };
    recordRemoteTiming('nightshift_native_handler', { scopeId, stepType: kind + '_optimize' });
    try {
      if (kind === 'cortex') {
        const handler = createCortexOptimizeHandler({
          isEnabled: () => enabled,
          runOptimize: (options) =>
            runCortexOptimize({
              ...options,
              logger,
              createModel: () => createModel(options),
              loadRound: (input) => loadInvestigationRound({ ...input, getConversationClient }),
              telemetry: {
                reportHydrated: () => {},
                reportEditsApplied: (edits) =>
                  report(
                    this.policy.reportCortex(scopeId, stepId, {
                      conversationId: options.conversationId,
                      roundId: options.roundId,
                      edits: [...edits],
                    })
                  ),
              },
            }),
        });
        return await handler(handlerContext as Parameters<typeof handler>[0]);
      }
      const handler = createMemoryOptimizeHandler({
        isEnabled: () => enabled,
        telemetry: {
          reportSemanticMemoryOptimized: ({ workflow_execution_id, ...event }) =>
            report(this.policy.reportMemory(scopeId, stepId, event)),
        },
        runOptimize: (options) =>
          runMemoryOptimize({
            ...options,
            logger,
            createModel: () => createModel(options),
            loadRound: (input) =>
              loadRoundSteps({ ...input, agentBuilder: undefined, getConversationClient }),
          }),
      });
      return await handler(handlerContext as Parameters<typeof handler>[0]);
    } finally {
      await Promise.all(localExecutions.map((execution) => execution.finalize()));
      await Promise.all(reporting);
      await this.policy.settle(scopeId, stepId);
      if (native) await (await native).drain();
    }
  }
}

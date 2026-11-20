/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { lazySchema, z } from '@kbn/zod/v4';
import { StepCategory } from '@kbn/workflows';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import type { AnalyticsServiceSetup, CoreStart, Logger } from '@kbn/core/server';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import type { InferenceServerStart } from '@kbn/inference-plugin/server';
import { createCortexOptimizeHandler } from '../remote/cortex_optimize';
import { MAX_KEYWORD_LENGTH } from '../../common';
import { runCortexOptimize } from '../cortex/register_cortex';
import { investigationRoundInputsSchema } from '../investigation_round';

export { withToolResults } from '../investigation_round/with_tool_results';

export const inputSchema = lazySchema(() =>
  z.object({
    ...investigationRoundInputsSchema,
    agent_id: z.string().max(1024).optional().describe('Agent id that produced the round.'),
    sandbox_id: z
      .string()
      .max(1024)
      .optional()
      .describe('Workspace key from nightshift.obtainSandbox. Already space-scoped.'),
    connector_id: z
      .string()
      .max(MAX_KEYWORD_LENGTH)
      .optional()
      .describe('Strict model override for a direct run. Fails when the id does not resolve.'),
    round_connector_id: z
      .string()
      .max(MAX_KEYWORD_LENGTH)
      .optional()
      .describe('Inference connector the triggering agent used for this round.'),
  })
);
export const outputSchema = lazySchema(() =>
  z.object({
    status: z.literal('ok').describe('The optimizer finished without throwing.'),
    skipped: z.boolean().optional(),
  })
);

export const cortexOptimizeStepDefinition = ({
  getAgentBuilder,
  getInference,
  getSavedObjects,
  getUiSettings,
  analytics,
  logger,
  isEnabled,
}: {
  getAgentBuilder: () => AgentBuilderPluginStart | undefined;
  getInference: () => InferenceServerStart | undefined;
  getSavedObjects: () => CoreStart['savedObjects'] | undefined;
  getUiSettings: () => CoreStart['uiSettings'] | undefined;
  analytics: AnalyticsServiceSetup;
  logger: Logger;
  isEnabled?: () => boolean;
}) =>
  createServerStepDefinition({
    id: 'nightshift.cortexOptimize',
    label: 'Optimize Nightshift Cortex',
    category: StepCategory.Ai,
    description:
      'Proposes Cortex wiki edits from a completed investigation round and writes them ' +
      'to the Context Engine AI index. sandbox_id identifies the workspace this round used; ' +
      'the optimizer currently reads the transcript, not the sandbox files.',
    inputSchema,
    outputSchema,
    handler: createCortexOptimizeHandler({
      isEnabled,

      runOptimize: (options) =>
        runCortexOptimize({
          ...options,
          getAgentBuilder,
          getInference,
          getSavedObjects,
          getUiSettings,
          logger,
          analytics,
        }),
    }),
  });

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { lazySchema, z } from '@kbn/zod/v4';
import { StepCategory } from '@kbn/workflows';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import type { CoreStart, Logger } from '@kbn/core/server';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import type { InferenceServerStart } from '@kbn/inference-plugin/server';
import { createMemoryOptimizeHandler } from '../remote/memory_optimize';
import { MAX_KEYWORD_LENGTH } from '../../common';
import { investigationRoundInputsSchema } from '../investigation_round';
import { runMemoryOptimize } from '../memory/register_memory';
import type { NightshiftTelemetryClient } from '../telemetry';

export const inputSchema = lazySchema(() =>
  z.object({
    ...investigationRoundInputsSchema,
    agent_id: z
      .string()
      .max(1024)
      .optional()
      .describe('Supported agent policy selector; never used as a storage boundary.'),
    recalled_ids: z
      .array(z.string().max(2_000))
      .max(100)
      .optional()
      .describe('Semantic Memory ids persisted on the completed conversation round.'),
    sandbox_id: z
      .string()
      .max(1024)
      .optional()
      .describe(
        'Workspace key from nightshift.obtainSandbox. Already space-scoped. ' +
          'Omit when there is no conversation sandbox.'
      ),
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
    status: z.literal('ok').describe('The memory optimizer finished without throwing.'),
    skipped: z.boolean().optional(),
  })
);

export const memoryOptimizeStepDefinition = ({
  getAgentBuilder,
  getInference,
  getSavedObjects,
  getUiSettings,
  logger,
  isEnabled,
  telemetry,
}: {
  getAgentBuilder: () => AgentBuilderPluginStart | undefined;
  getInference: () => InferenceServerStart | undefined;
  getSavedObjects: () => CoreStart['savedObjects'] | undefined;
  getUiSettings: () => CoreStart['uiSettings'] | undefined;
  logger: Logger;
  isEnabled?: () => boolean;
  telemetry: NightshiftTelemetryClient;
}) =>
  createServerStepDefinition({
    id: 'nightshift.memoryOptimize',
    label: 'Optimize Nightshift Semantic Memory',
    category: StepCategory.Ai,
    description:
      'Labels recalled Semantic Memory pages from a completed investigation round and ' +
      'extracts durable customer-environment facts into the Semantic Memory index.',
    inputSchema,
    outputSchema,
    handler: createMemoryOptimizeHandler({
      isEnabled,
      telemetry,
      runOptimize: (options) =>
        runMemoryOptimize({
          ...options,
          getAgentBuilder,
          getInference,
          getSavedObjects,
          getUiSettings,
          logger,
        }),
    }),
  });

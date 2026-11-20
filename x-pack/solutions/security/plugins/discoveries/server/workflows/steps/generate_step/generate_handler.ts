/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { z } from '@kbn/zod/v4';
import type {
  GenerateStepInputSchema,
  GenerateStepOutputSchema,
} from '../../../../common/step_types/generate_step';
import type { invokeGenerationGraph } from './helpers/invoke_generation_graph';
import { transformDiscoveriesOutput } from './helpers/transform_discoveries_output';

export type GenerateContext = StepHandlerContext<typeof GenerateStepInputSchema>;
export type GenerationInput = Pick<
  Parameters<typeof invokeGenerationGraph>[0],
  'additionalContext' | 'replacements' | 'size' | 'sourceAlerts'
>;
export type GenerationResult = Awaited<ReturnType<typeof invokeGenerationGraph>>;
export interface PreparedGeneration {
  executionUuid: string;
  invoke(input: GenerationInput): Promise<GenerationResult>;
}
export const createGenerateHandler =
  (prepare: (context: GenerateContext) => Promise<PreparedGeneration>) =>
  async (
    context: GenerateContext
  ): Promise<{ output: z.infer<typeof GenerateStepOutputSchema> } | { error: Error }> => {
    let executionUuid: string | undefined;

    try {
      const { additional_context: additionalContext, replacements, size } = context.input;
      const alerts = context.input.alerts ?? [];

      context.logger.info(
        `Starting attack discovery generation from ${alerts.length} pre-retrieved alerts`
      );

      const prepared = await prepare(context);
      executionUuid = prepared.executionUuid;

      if (alerts.length === 0) {
        context.logger.info(
          `Skipping graph execution because 0 alerts were provided (execution: ${executionUuid})`
        );

        return {
          output: {
            attack_discoveries: null,
            execution_uuid: executionUuid,
            replacements: replacements ?? {},
          },
        };
      }

      const result = await prepared.invoke({
        additionalContext,
        replacements,
        size,
        sourceAlerts: alerts,
      });

      context.logger.info(
        `Attack Discovery generation completed: ${result.discoveries?.length ?? 0} discoveries`
      );

      const attackDiscoveriesOutput = transformDiscoveriesOutput(result.discoveries, {
        executionUuid,
      });

      return {
        output: {
          attack_discoveries: attackDiscoveriesOutput,
          execution_uuid: executionUuid,
          replacements: result.replacements,
        },
      };
    } catch (error) {
      context.logger.error(
        `Generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );

      return {
        error: new Error(error instanceof Error ? error.message : 'Failed to generate discoveries'),
      };
    }
  };

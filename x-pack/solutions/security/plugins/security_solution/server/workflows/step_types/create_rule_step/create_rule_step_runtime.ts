/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler, RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { remotable } from '@kbn/core-remote-common';
import type { z } from '@kbn/zod/v4';
import { DETECTION_ENGINE_RULES_URL } from '../../../../common/api_urls';
import type {
  createRuleOutputSchema,
  createRuleStepCommonDefinition,
} from '../../../../common/workflows/step_types/create_rule_step/create_rule_step_common';
import { toApiExecutionError } from '../../utils/to_api_execution_error';

type CreateRuleOutput = z.infer<typeof createRuleOutputSchema>;

export const handleCreateRuleStep: StepHandler<
  typeof createRuleStepCommonDefinition.inputSchema,
  typeof createRuleStepCommonDefinition.outputSchema
> = async (context) => {
  try {
    const { rule } = context.input;
    const { body } = await context.contextManager.callKibanaApi<CreateRuleOutput>({
      method: 'POST',
      path: DETECTION_ENGINE_RULES_URL,
      // Always create the rule disabled, overriding any "enabled" in the input.
      body: { ...rule, enabled: false },
    });
    return { output: body };
  } catch (error) {
    throw toApiExecutionError(error, 'create detection rule');
  }
};

/** Runs the same handler as in-Kibana without importing its authoring schemas. */
@remotable()
export class CreateRuleStep {
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [, , { handlerContext }] = args;
    if (!handlerContext)
      throw new Error('security.createRule requires executor-local handler context');
    return handleCreateRuleStep(handlerContext as Parameters<typeof handleCreateRuleStep>[0]);
  }
}

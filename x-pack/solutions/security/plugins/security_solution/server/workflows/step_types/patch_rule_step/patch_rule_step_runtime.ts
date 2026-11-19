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
  patchRuleOutputSchema,
  patchRuleStepCommonDefinition,
} from '../../../../common/workflows/step_types/patch_rule_step/patch_rule_step_common';
import { toApiExecutionError } from '../../utils/to_api_execution_error';

type PatchRuleOutput = z.infer<typeof patchRuleOutputSchema>;

export const handlePatchRuleStep: StepHandler<
  typeof patchRuleStepCommonDefinition.inputSchema,
  typeof patchRuleStepCommonDefinition.outputSchema
> = async (context) => {
  try {
    const { body } = await context.contextManager.callKibanaApi<PatchRuleOutput>({
      method: 'PATCH',
      path: DETECTION_ENGINE_RULES_URL,
      body: context.input.patch,
    });
    return { output: body };
  } catch (error) {
    throw toApiExecutionError(error, 'patch detection rule');
  }
};

/** Runs the same handler as in-Kibana without importing its authoring schemas. */
@remotable()
export class PatchRuleStep {
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [, , { handlerContext }] = args;
    if (!handlerContext)
      throw new Error('security.patchRule requires executor-local handler context');
    return handlePatchRuleStep(handlerContext as Parameters<typeof handlePatchRuleStep>[0]);
  }
}

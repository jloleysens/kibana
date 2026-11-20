/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler, RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { remotable } from '@kbn/core-remote-common';
import { DETECTION_ENGINE_RULES_BULK_ACTION } from '../../../../common/api_urls';
import type { BulkEditActionResponse } from '../../../../common/api/detection_engine/rule_management';
import type { enableRuleStepCommonDefinition } from '../../../../common/workflows/step_types/enable_rule_step/enable_rule_step_common';
import { handleBulkRuleActionError, toBulkRuleActionOutput } from '../../utils/bulk_rule_action';

export const handleEnableRuleStep: StepHandler<
  typeof enableRuleStepCommonDefinition.inputSchema,
  typeof enableRuleStepCommonDefinition.outputSchema
> = async (context) => {
  try {
    const { body } = await context.contextManager.callKibanaApi<BulkEditActionResponse>({
      method: 'POST',
      path: DETECTION_ENGINE_RULES_BULK_ACTION,
      body: { ...context.input, action: 'enable' },
    });

    return toBulkRuleActionOutput(body);
  } catch (error) {
    return handleBulkRuleActionError(error, 'enable rules');
  }
};

/** Runs the same handler as in-Kibana without importing its authoring schemas. */
@remotable()
export class EnableRuleStep {
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    const [, , { handlerContext }] = args;
    if (!handlerContext)
      throw new Error('security.enableRule requires executor-local handler context');
    return handleEnableRuleStep(handlerContext as Parameters<typeof handleEnableRuleStep>[0]);
  }
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler } from '@kbn/workflows-extensions/server';
import type { InvestigationsApi } from './investigations_tokens';
import { inputSchema, type outputSchema } from './follow_up_recovered_alert_schema';

type Handler = StepHandler<typeof inputSchema, typeof outputSchema>;
export const createFollowUpRecoveredAlertHandler =
  (
    followUp: (
      context: Parameters<Handler>[0],
      input: Parameters<InvestigationsApi['followUpRecoveredAlert']>[1]
    ) => ReturnType<InvestigationsApi['followUpRecoveredAlert']>
  ): Handler =>
  async (context) => {
    const input = inputSchema.parse(context.input);
    const result = await followUp(context, {
      alertUuid: input.alert_uuid,
      alertId: input.alert_id,
      alertStart: input.alert_start,
      recoveredAt: input.recovered_at,
      ruleId: input.rule_id,
      ruleName: input.rule_name,
      ruleTypeId: input.rule_type_id,
      ruleTags: input.rule_tags,
    });
    return { output: result ?? { skip_reason: 'no_open_investigation' as const } };
  };

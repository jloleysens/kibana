/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { StepCategory } from '@kbn/workflows';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import type { GetInvestigationsClient } from '../routes/types';

import { inputSchema, outputSchema } from '../remote/follow_up_recovered_alert_schema';
import { createFollowUpRecoveredAlertHandler } from '../remote/follow_up_recovered_alert';

export const followUpRecoveredAlertStepDefinition = (
  getInvestigationsClient: GetInvestigationsClient
) =>
  createServerStepDefinition({
    id: 'nightshift.followUpRecoveredAlert',
    label: 'Follow Up on a Recovered Alert',
    category: StepCategory.Ai,
    description:
      'When an open investigation holds the recovered alert, runs a round on it that checks whether the recovery confirms or refutes its root cause. Never starts an investigation. Returns investigation_id and the execution_id of the round, or skip_reason when no open investigation holds the alert.',
    inputSchema,
    outputSchema,
    handler: createFollowUpRecoveredAlertHandler((context, input) => {
      const request = context.contextManager.getFakeRequest();
      // The workflow Space is not carried by getFakeRequest().
      const { workflow } = context.contextManager.getContext();
      return getInvestigationsClient(request, workflow.spaceId).followUpRecoveredAlert(input);
    }),
  });

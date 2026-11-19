/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler } from '@kbn/workflows-extensions/server';
import { inputSchema, type outputSchema } from './render_slack_message_schema';
import type { InvestigationRenderingInput } from './investigations_tokens';
import { renderInvestigationSlackMessage } from '../lib/notifications/format_investigation_slack_message';

type Handler = StepHandler<typeof inputSchema, typeof outputSchema>;
export const createRenderSlackMessageHandler =
  (
    getRenderingInput: (
      context: Parameters<Handler>[0],
      investigationId: string
    ) => Promise<InvestigationRenderingInput>
  ): Handler =>
  async (context) => {
    const { investigation_id: investigationId, phase, reason } = inputSchema.parse(context.input);
    const { investigation, redirectUrl } = await getRenderingInput(context, investigationId);
    const { kibanaUrl } = context.contextManager.getContext();
    const url = new URL(redirectUrl, kibanaUrl).toString();
    return { output: renderInvestigationSlackMessage({ investigation, url, phase, reason }) };
  };

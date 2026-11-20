/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { StepCategory } from '@kbn/workflows';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import type { InvestigationLocator } from '../../common/locators';
import type { GetInvestigationsClient } from '../routes/types';

import { inputSchema, outputSchema } from '../remote/render_slack_message_schema';
import { createRenderSlackMessageHandler } from '../remote/render_slack_message';

/**
 * Renders an investigation's lifecycle message for Slack the way Nightshift notifications do, for
 * workflows that post it themselves with `slack2.sendMessage` or `slack2.updateMessage`.
 */
export const renderSlackMessageStepDefinition = ({
  investigationLocator,
  getInvestigationsClient,
}: {
  investigationLocator: Pick<InvestigationLocator, 'getRedirectUrl'>;
  getInvestigationsClient: GetInvestigationsClient;
}) =>
  createServerStepDefinition({
    id: 'nightshift.renderSlackMessage',
    label: 'Render Nightshift Slack message',
    category: StepCategory.Ai,
    description:
      'Renders an investigation lifecycle message as Slack Block Kit blocks with fallback text.',
    inputSchema,
    outputSchema,
    handler: createRenderSlackMessageHandler(async (context, investigationId) => {
      const {
        workflow: { spaceId },
      } = context.contextManager.getContext();
      const investigation = await getInvestigationsClient(
        context.contextManager.getFakeRequest(),
        spaceId
      ).getNotifiableInvestigation(investigationId);
      return {
        investigation,
        redirectUrl: investigationLocator.getRedirectUrl({ investigationId }, { spaceId }),
      };
    }),
  });

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { z } from '@kbn/zod/v4';
import type { StepHandler, StepHandlerContext } from '@kbn/workflows-extensions/server';
import {
  DEFAULT_MANUAL_INVESTIGATION_SUBJECT_ID,
  toSlackThreadSubjectId,
} from '../../common/investigation_subject';
import { AutomationDailyLimitReachedError, InvestigationQuotaDeniedError } from '../client/errors';
import type { GetInvestigationsClient } from '../routes/types';
import { inputSchema } from './trigger_investigation_schema';
import type { outputSchema } from './trigger_investigation_schema';

type Client = ReturnType<GetInvestigationsClient>;
export interface InvestigationDispatchDeps<Reference> {
  prepare: (context: StepHandlerContext, automationId?: string) => Promise<Reference>;
  resolveAlerts: (
    context: StepHandlerContext,
    subjectId: string
  ) => Promise<NonNullable<Parameters<Client['start']>[0]['context']>['alerts']>;
  start: (
    reference: Reference,
    input: Parameters<Client['start']>[0]
  ) => ReturnType<Client['start']>;
  notifyQuota: (
    context: StepHandlerContext,
    slackThread: NonNullable<z.infer<typeof inputSchema>['slack_thread']>,
    reference: Reference
  ) => Promise<void>;
}

const toSubjectId = ({
  subject_type: subjectType,
  subject_id: subjectId,
  slack_thread: slackThread,
  message,
}: z.infer<typeof inputSchema>): string => {
  if (subjectType === 'slack_thread') {
    if (!slackThread) throw new Error('Slack thread investigations require slack_thread.');
    if (subjectId) {
      throw new Error('Slack thread investigations take their subject ID from slack_thread.');
    }
    if (!message?.trim()) throw new Error('Slack thread investigations require a message.');
    return toSlackThreadSubjectId(slackThread);
  }
  if (subjectType === 'manual') {
    if (!message?.trim()) throw new Error('Manual investigations require a message.');
    return subjectId ?? DEFAULT_MANUAL_INVESTIGATION_SUBJECT_ID;
  }
  if (!subjectId) {
    throw new Error('Alert and significant event investigations require a subject ID.');
  }
  return subjectId;
};

export const createTriggerInvestigationHandler =
  <Reference>({
    prepare,
    resolveAlerts,
    start,
    notifyQuota,
  }: InvestigationDispatchDeps<Reference>): StepHandler<typeof inputSchema, typeof outputSchema> =>
  async (context) => {
    const input = inputSchema.parse(context.input);
    const subjectId = toSubjectId(input);
    const prepared = await prepare(context, input.automation_id);
    const alerts =
      input.subject_type === 'alert' && !input.context?.alerts
        ? await resolveAlerts(context, subjectId)
        : undefined;
    try {
      const result = await start(prepared, {
        subject: {
          type: input.subject_type,
          id: subjectId,
          summary: input.summary,
        },
        title: input.title,
        trigger_type: input.trigger_type ?? 'automatic',
        message: input.message,
        source_ids: input.source_ids,
        context: alerts
          ? { alerts }
          : input.scope_query && input.subject_type === 'manual'
          ? { ...input.context, scope_query: input.scope_query }
          : input.context,
        timeout_seconds: input.timeout_seconds,
        notificationDestinations: input.notificationDestinations,
        slack_thread: input.slack_thread,
      });
      return { output: result };
    } catch (error) {
      if (error instanceof AutomationDailyLimitReachedError) {
        context.logger.info(
          `Skipped investigation of ${input.subject_type}/${subjectId} for automation ${input.automation_id}: daily limit of ${error.limit} reached`
        );
        return { output: { skip_reason: 'daily_limit' as const, daily_limit: error.limit } };
      }
      if (error instanceof InvestigationQuotaDeniedError) {
        context.logger.info(
          `Skipped investigation of ${input.subject_type}/${subjectId}: global investigation limit reached`
        );
        if (input.slack_thread) {
          await notifyQuota(context, input.slack_thread, prepared);
        }
        return { output: { skip_reason: 'investigation_limit' as const } };
      }
      throw error;
    }
  };

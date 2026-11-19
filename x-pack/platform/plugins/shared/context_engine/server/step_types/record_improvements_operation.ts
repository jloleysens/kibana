/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, KibanaRequest } from '@kbn/core/server';
import { ExecutionError } from '@kbn/workflows/server';
import { IMPROVEMENT_ACTIONS } from '../../common/http_api/improvement_actions';
import { AiIndexNotFoundError } from '../ai_indices/errors';
import { recordImprovements } from '../feedback_analysis/record_improvements';
import type { RecordImprovementsOptions } from '../feedback_analysis/record_improvements';
import { improvementAuditEvent } from '../audit/audit_events';
import type { FeedbackAnalysisStepDependencies } from './helpers';

export type RecordImprovementsParams = Pick<
  RecordImprovementsOptions,
  'aiIndexId' | 'agentRunId' | 'signalWindow' | 'signalSpaces' | 'proposals'
>;

export const recordImprovementsForIndex = async (
  {
    aiIndexId,
    agentRunId,
    signalWindow,
    signalSpaces,
    proposals: improvements,
  }: RecordImprovementsParams,
  {
    request,
    spaceId,
    esClient,
    getAuditLogger,
    getAiIndexService,
    getImprovementsService,
    logger,
  }: Pick<
    FeedbackAnalysisStepDependencies,
    'getAuditLogger' | 'getAiIndexService' | 'getImprovementsService' | 'logger'
  > & { request: KibanaRequest; spaceId: string; esClient: ElasticsearchClient }
): ReturnType<typeof recordImprovements> => {
  const auditLogger = await getAuditLogger(request);
  try {
    const { feedback_analysis: feedbackAnalysis } = await getAiIndexService().get(
      aiIndexId,
      spaceId
    );
    const allowedActions = feedbackAnalysis?.allowed_actions ?? [...IMPROVEMENT_ACTIONS];

    const result = await recordImprovements({
      aiIndexId,
      spaceId,
      agentRunId,
      signalWindow,
      signalSpaces,
      allowedActions,
      proposals: improvements,
      improvementsService: getImprovementsService(esClient, spaceId),
    });

    auditLogger?.log(improvementAuditEvent({ aiIndexId, recorded: result.recorded.length }));
    logger.debug(
      () =>
        `Analysis run '${agentRunId}' on AI index '${aiIndexId}': recorded ${result.recorded.length}, skipped ${result.skipped.length}`
    );

    return result;
  } catch (error) {
    auditLogger?.log(
      improvementAuditEvent({
        aiIndexId,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    );
    if (error instanceof AiIndexNotFoundError) {
      throw new ExecutionError({
        type: 'NotFoundError',
        message: `AI index '${aiIndexId}' not found`,
      });
    }
    throw error;
  }
};

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { GetWorkflowCasesClient } from '../types';
import type { AddAttachmentsStepInput } from '../../../common/workflows/steps/add_attachments';
import type { CasesStepSingleCaseOutputSchema } from '../../../common/workflows/steps/shared';
import type { UnifiedAttachmentPayload } from '../../../common/types/domain/attachment/v2';
import { toLegacyCaseResponse } from '../../common/attachments';
import { createCasesStepHandler, safeParseCaseForWorkflowOutput, withCaseOwner } from './utils';

export const createAddAttachmentsHandler = (
  getCasesClient: GetWorkflowCasesClient,
  outputSchema: typeof CasesStepSingleCaseOutputSchema
) =>
  createCasesStepHandler(getCasesClient, async (client, input: AddAttachmentsStepInput) => {
    return withCaseOwner(client, input.case_id, async (owner) => {
      const attachments = input.attachments.map((attachment) => ({
        ...(attachment as Record<string, unknown>),
        owner,
      })) as UnifiedAttachmentPayload[];

      const updatedCase = await client.attachments.bulkCreate({
        caseId: input.case_id,
        attachments,
      });
      // The client returns unified comments; the output schema mirrors the
      // public (legacy) wire shape, so convert back before validating.
      return safeParseCaseForWorkflowOutput(
        outputSchema.shape.case,
        toLegacyCaseResponse(updatedCase)
      );
    });
  });

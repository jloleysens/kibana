/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { CasesStepSingleCaseOutputSchema } from '../../common/workflows/steps/shared';
import { createAddAttachmentsHandler } from '../workflows/steps/add_attachments_handler';
import {
  CasesClientOperationsToken,
  type CasesClientOperationsApi,
} from './client_operations_tokens';
import { runCasesStep } from './run_cases_step';

export class AddAttachmentsStep implements RemoteWorkflowStep {
  constructor(@inject(CasesClientOperationsToken) private readonly api: CasesClientOperationsApi) {}
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    return runCasesStep(
      this.api,
      async (getClient) => {
        await this.api.assertConditionalStep(args[0], 'cases.addAttachments');
        return {
          id: 'cases.addAttachments',
          handler: createAddAttachmentsHandler(getClient, CasesStepSingleCaseOutputSchema),
        };
      },
      ...args
    );
  }
}

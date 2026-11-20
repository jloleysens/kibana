/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server/step_registry/types';
import {
  removeTagsStepCommonDefinition,
  type RemoveTagsStepInput,
} from '../../../common/workflows/steps/remove_tags';
import type { WorkflowCasesClient as CasesClient } from '../types';
import { createCasesStepHandler } from './utils';
import { updateSingleCaseFromInput } from './update_case_helpers';

export const removeTagsStepDefinition = (
  getCasesClient: (request: KibanaRequest) => Promise<CasesClient>
) =>
  createServerStepDefinition({
    ...removeTagsStepCommonDefinition,
    handler: createCasesStepHandler(getCasesClient, async (client, input: RemoveTagsStepInput) => {
      const currentCase = await client.cases.get({
        id: input.case_id,
        includeComments: false,
      });

      const tagsToRemove = new Set(input.tags);
      const tags = (currentCase.tags ?? []).filter((tag) => !tagsToRemove.has(tag));

      return updateSingleCaseFromInput(
        client,
        { ...input, version: currentCase.version },
        { tags }
      );
    }),
  });

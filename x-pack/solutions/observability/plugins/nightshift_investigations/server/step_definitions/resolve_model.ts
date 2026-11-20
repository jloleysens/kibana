/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { StepCategory } from '@kbn/workflows';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { lazySchema, z } from '@kbn/zod/v4';
import { MAX_KEYWORD_LENGTH } from '../../common';
import { createModelResolver, type ModelResolutionDeps } from '../remote/model_resolution';
import { createResolveModelHandler } from '../remote/resolve_model';

export const inputSchema = lazySchema(() =>
  z.object({
    step: z.literal('investigation'),
    connector_id: z.string().max(MAX_KEYWORD_LENGTH).optional(),
    round_connector_id: z.string().max(MAX_KEYWORD_LENGTH).optional(),
  })
);
export const outputSchema = lazySchema(() =>
  z.object({
    connector_id: z.string(),
  })
);

export const resolveModelStepDefinition = (deps: ModelResolutionDeps) => {
  const resolveModel = createModelResolver(deps);
  return createServerStepDefinition({
    id: 'nightshift.resolveModel',
    label: 'Resolve Nightshift model',
    category: StepCategory.Ai,
    description: 'Validates and resolves the model used by a Nightshift investigation step.',
    inputSchema,
    outputSchema,

    handler: createResolveModelHandler((context, input) =>
      resolveModel(context.contextManager.getFakeRequest(), input)
    ),
  });
};

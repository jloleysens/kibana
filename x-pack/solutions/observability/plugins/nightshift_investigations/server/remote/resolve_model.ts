/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandler } from '@kbn/workflows-extensions/server';
import type { inputSchema, outputSchema } from '../step_definitions/resolve_model';
import type { ModelSelectionApi, ModelSelectionInput } from './model_selection_tokens';

type Handler = StepHandler<typeof inputSchema, typeof outputSchema>;
export const createResolveModelHandler =
  (
    resolveModel: (
      context: Parameters<Handler>[0],
      input: ModelSelectionInput
    ) => ReturnType<ModelSelectionApi['resolve']>
  ): Handler =>
  async (context) => ({ output: { connector_id: await resolveModel(context, context.input) } });

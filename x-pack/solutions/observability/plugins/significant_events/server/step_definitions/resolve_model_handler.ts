/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { z } from '@kbn/zod/v4';
import type { ResolveModelInput } from './resolve_model';

export const createResolveModelHandler =
  (resolve: (input: ResolveModelInput) => Promise<string>) =>
  async (
    context: StepHandlerContext<z.ZodType<ResolveModelInput>>
  ): Promise<{ output: { connector_id: string } }> => ({
    output: { connector_id: await resolve(context.input) },
  });

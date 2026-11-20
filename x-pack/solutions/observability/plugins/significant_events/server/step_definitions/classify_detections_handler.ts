/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { z } from '@kbn/zod/v4';
import type { ClassifyDetectionsInput, ClassifyDetectionsOutput } from './classify_detections';

export type ClassifyDetectionsContext = StepHandlerContext<z.ZodType<ClassifyDetectionsInput>>;
export const createClassifyDetectionsHandler =
  (
    classify: (
      input: ClassifyDetectionsInput,
      abortSignal: AbortSignal
    ) => Promise<{ output: ClassifyDetectionsOutput }>
  ) =>
  async (context: ClassifyDetectionsContext): Promise<{ output: ClassifyDetectionsOutput }> =>
    classify(context.input, context.abortSignal);

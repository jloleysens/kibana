/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import type { AiClassifyStepInputSchema } from './ai_classify_step';

export const CategorySchema = z.union([
  z.string(),
  z.object({ name: z.string(), description: z.string() }),
]);

export type Category = z.infer<typeof CategorySchema>;
export const getCategoryName = (category: Category): string =>
  typeof category === 'string' ? category : category.name;

/**
 * Output schema for the AI classify step.
 * This is the base schema - the dynamic schema will be created based on input parameters.
 */
export const OutputSchema = z.object({
  category: z.string().optional(),
  categories: z.array(z.string()).optional(),
  rationale: z.string().optional(),
  metadata: z.record(z.string(), z.any()),
});

/**
 * Builds a dynamic Zod schema for structured output based on AI classification step inputs.
 */
export function buildStructuredOutputSchema(
  params: z.infer<AiClassifyStepInputSchema>
): typeof OutputSchema {
  const { allowMultipleCategories, includeRationale } = params;

  const shape: Record<string, z.ZodType> = {
    metadata: z.record(z.string(), z.any()),
  };

  if (allowMultipleCategories) {
    shape.categories = z.array(z.string());
  } else {
    shape.category = z.string();
  }

  if (includeRationale) {
    shape.rationale = z.string();
  }

  return z.object(shape) as typeof OutputSchema;
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { z } from '@kbn/zod/v4';

import { JSON_SCHEMA_FORMAT_VALUES, JSON_SCHEMA_TYPE_VALUES } from './json_model_shape';
import type { JsonSchema } from './json_model_shape';
import { builtinWorkflowInputDefinitionRefSchema } from '../../builtin_workflow_input_definitions';
export {
  JSON_SCHEMA_TYPE_VALUES,
  JSON_SCHEMA_FORMAT_VALUES,
  JSON_SCHEMA_PROPERTY_KEYS,
  isSchemaValuedAdditionalProperties,
} from './json_model_shape';
export type { JsonSchemaType, JsonSchema } from './json_model_shape';

/** Shared `type` keyword (single type or array of types). */
const jsonSchemaTypeField = z
  .union([z.enum(JSON_SCHEMA_TYPE_VALUES), z.array(z.enum(JSON_SCHEMA_TYPE_VALUES))])
  .optional();

/**
 * Zod schema representing any JSON Schema node (Draft 7 / 2020-12)
 * Used recursively inside property definitions, anyOf/oneOf, etc...
 * Only includes keywords that the fromJSONSchema converter actually enforces
 */
export const JsonModelShapeSchema: z.ZodType<JsonSchema> = z
  .lazy(() =>
    z.object({
      type: jsonSchemaTypeField,
      title: z.string().optional(),
      description: z.string().optional(),
      format: z.enum(JSON_SCHEMA_FORMAT_VALUES).optional(),
      default: z.any().optional(),
      $ref: builtinWorkflowInputDefinitionRefSchema.optional(),

      // --- Logical Operators ---
      anyOf: z.array(JsonModelShapeSchema).optional(),
      oneOf: z.array(JsonModelShapeSchema).optional(),

      // --- Object Properties ---
      properties: z.record(z.string(), JsonModelShapeSchema).optional(),
      additionalProperties: z.union([z.boolean(), JsonModelShapeSchema]).optional(),
      required: z.array(z.string()).optional(),

      // --- Array Properties ---
      items: z.union([JsonModelShapeSchema, z.array(JsonModelShapeSchema)]).optional(),
      minItems: z.number().int().nonnegative().optional(),
      maxItems: z.number().int().nonnegative().optional(),
      uniqueItems: z.boolean().optional(),

      // --- Reusability ---
      definitions: z.record(z.string(), JsonModelShapeSchema).optional(),
      $defs: z.record(z.string(), JsonModelShapeSchema).optional(),

      // --- Value Constraints ---
      const: z.any().optional(),
      enum: z.array(z.any()).optional(),
      multipleOf: z.number().positive().optional(),
      minimum: z.number().optional(),
      exclusiveMinimum: z.number().optional(),
      maximum: z.number().optional(),
      exclusiveMaximum: z.number().optional(),
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().nonnegative().optional(),
      pattern: z.string().optional(),
    })
  )
  .meta({ jsonSchemaModel: true });

/**
 * Root-level JSON Schema shape for workflow inputs.
 * Only exposes object-level keywords (properties, required, definitions, etc.)
 * so that monaco-yaml autocomplete at the `inputs:` level does not suggest
 * irrelevant constraint keywords like enum, maxLength, minimum, etc.
 * Individual property schemas inside `properties` still use the full
 * JsonModelShapeSchema with all keywords available.
 */
export const JsonModelRootShapeSchema = z
  .object({
    type: z.literal('object').optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    $ref: builtinWorkflowInputDefinitionRefSchema.optional(),
    properties: z.record(z.string(), JsonModelShapeSchema).optional(),
    additionalProperties: z.union([z.boolean(), JsonModelShapeSchema]).optional(),
    required: z.array(z.string()).optional(),
    definitions: z.record(z.string(), JsonModelShapeSchema).optional(),
    $defs: z.record(z.string(), JsonModelShapeSchema).optional(),
  })
  .meta({ jsonSchemaModel: true });

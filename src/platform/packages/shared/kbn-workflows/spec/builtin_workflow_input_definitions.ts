/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { z } from '@kbn/zod/v4';
import {
  builtinWorkflowInputDefinitions,
  KIBANA_WORKFLOW_INPUT_DEFINITION_REF_PREFIX,
} from './builtin_workflow_input_definitions_data';
import type { JsonSchema } from './schema/common/json_model_shape_schema';
export {
  builtinWorkflowInputDefinitions,
  KIBANA_WORKFLOW_INPUT_DEFINITION_REF_PREFIX,
  ALERTING_V2_NOTIFICATION_GROUP_INPUT_DEFINITION_ID,
  SECURITY_ALERT_ANALYSIS_CALLER_ALERTS_INPUT_DEFINITION_ID,
} from './builtin_workflow_input_definitions_data';

const builtinRefList = Object.keys(builtinWorkflowInputDefinitions).map(
  (id) => `${KIBANA_WORKFLOW_INPUT_DEFINITION_REF_PREFIX}${id}`
);

/**
 * Literal values suggested for `$ref` under workflow `inputs` JSON Schema (Monaco YAML).
 * Kept in sync with {@link builtinWorkflowInputDefinitions} keys.
 */
export const builtinWorkflowInputDefinitionRefValuesForZod = builtinRefList as [
  string,
  ...string[]
];

/**
 * Zod schema for `$ref` under workflow inputs: suggests known built-in refs
 */
export const builtinWorkflowInputDefinitionRefSchema =
  builtinRefList.length > 0
    ? z.union([z.enum(builtinWorkflowInputDefinitionRefValuesForZod), z.string().max(512)])
    : z.string().max(512);

/**
 * Merges {@link builtinWorkflowInputDefinitions} under `kibana.definitions` on the workflow
 * root JSON Schema document so `#/kibana/definitions/<id>` resolves for Monaco YAML and other
 * schema consumers that walk the document root.
 */
export function mergeKibanaBuiltinWorkflowInputDefinitionsIntoRootSchema<T extends object>(
  root: T | null
): T | null {
  if (!root || typeof root !== 'object') {
    return root;
  }
  if (builtinRefList.length === 0) {
    return root;
  }

  const existingKibana = (root as { kibana?: Record<string, unknown> }).kibana;
  const kibanaObject =
    existingKibana && typeof existingKibana === 'object' && !Array.isArray(existingKibana)
      ? existingKibana
      : {};

  const existingDefinitions = kibanaObject.definitions;
  const definitionsObject =
    existingDefinitions &&
    typeof existingDefinitions === 'object' &&
    !Array.isArray(existingDefinitions)
      ? (existingDefinitions as Record<string, JsonSchema>)
      : {};

  return {
    ...root,
    kibana: {
      ...kibanaObject,
      // Built-ins win on key collision so canonical Kibana shapes stay authoritative for Monaco $ref.
      definitions: {
        ...definitionsObject,
        ...builtinWorkflowInputDefinitions,
      },
    },
  };
}

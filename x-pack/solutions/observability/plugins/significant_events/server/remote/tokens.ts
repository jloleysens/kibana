/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type {
  ClassifyDetectionsInput,
  ClassifyDetectionsOutput,
} from '../step_definitions/classify_detections';
import type { ResolveModelInput } from '../step_definitions/resolve_model';

export interface SignificantEventsOperationsApi {
  resolveModel(scopeId: string, input: ResolveModelInput): Promise<string>;
  openClassification(scopeId: string, stepId: string): Promise<string>;
  classify(
    scopeId: string,
    reference: string,
    input: ClassifyDetectionsInput
  ): Promise<{ output: ClassifyDetectionsOutput }>;
  closeClassification(scopeId: string, reference: string): Promise<void>;
}
export const SignificantEventsOperationsToken = createToken<SignificantEventsOperationsApi>(
  'significantEvents.operations'
);
export const WorkflowStepKind = createToken('workflows.step');

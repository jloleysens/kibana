/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { ActionsClient } from '@kbn/actions-plugin/server';
import type { AnonymizationFailureMode, AnonymizationRule } from '@kbn/ai-anonymization-common';
import type { RegexWorker } from '@kbn/ai-anonymization-server';

export interface InferencePolicy {
  readonly namespace: string;
  readonly rules: AnonymizationRule[];
  readonly onFailure: AnonymizationFailureMode;
  readonly defaultConnector: string;
  readonly defaultOnly: boolean;
  readonly tokenUsageTracking: boolean;
  readonly streaming: boolean;
  readonly regexWorkerEnabled: boolean;
  readonly stackConnectors:
    | Awaited<ReturnType<ActionsClient['getAll']>>
    | { readonly error: string };
}
export interface InferencePolicyApi {
  read(scopeId: string): Promise<InferencePolicy | null>;
  runRegexRules(
    scopeId: string,
    payload: Parameters<RegexWorker['run']>[0]
  ): ReturnType<RegexWorker['run']>;
}
export const InferencePolicyToken = createToken<InferencePolicyApi>('inference.policy');

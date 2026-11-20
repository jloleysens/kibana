/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { SerializedError } from '@kbn/workflows';
import type { ReinforcementServices } from './decision_tree_reinforce';

type RunOptions = Parameters<ReinforcementServices['runAgent']>[0];
export interface ReinforcementInput {
  defaultConnectorId?: string;
  conversation: RunOptions['agentParams']['conversation'];
  message: string | undefined;
  includeLearningTools: boolean;
}
export interface ReinforcementResult {
  message?: string;
  error?: Error;
  sizeError?: SerializedError;
}
export interface ReinforcementApi {
  read(scopeId: string): Promise<{ enabled: boolean; available: boolean }>;
  begin(scopeId: string, stepId: string, input: ReinforcementInput): Promise<string>;
  take(scopeId: string, reference: string): Promise<ReinforcementResult>;
  cancel(scopeId: string, reference: string): Promise<void>;
}
export const ReinforcementToken = createToken<ReinforcementApi>('nightshift.reinforcement');

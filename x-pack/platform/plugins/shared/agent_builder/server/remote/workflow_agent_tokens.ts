/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { SerializedError } from '@kbn/workflows';
import type { WorkflowAgentOutcome, WorkflowAgentParams } from './run_agent_types';

export interface WorkflowAgentResult {
  outcome: WorkflowAgentOutcome;
  sizeError?: SerializedError;
}

export interface WorkflowAgentApi {
  runAgent(scopeId: string, stepId: string, params: WorkflowAgentParams): Promise<string>;
  takeResult(scopeId: string, resultId: string): Promise<WorkflowAgentResult>;
  cancel(scopeId: string, resultId: string): Promise<void>;
}

export const WorkflowAgentToken = createToken<WorkflowAgentApi>('agentBuilder.workflowAgent');

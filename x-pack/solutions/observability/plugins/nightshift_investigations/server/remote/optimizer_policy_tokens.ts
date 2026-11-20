/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ModelObservationsApi } from '@kbn/agent-builder-plugin/server/remote/model_observations_api';
import { createToken } from '@kbn/core-di';
import type { AppliedCortexEdit } from '../telemetry/cortex_telemetry';
import type { SemanticMemoryOptimizedEvent } from '../telemetry/events';
export interface OptimizerPolicyApi extends ModelObservationsApi {
  log(
    scopeId: string,
    stepId: string,
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
    message: string
  ): Promise<void>;
  enabled(scopeId: string, stepId: string): Promise<boolean>;
  prepareModel(
    scopeId: string,
    stepId: string,
    input: { requestedConnectorId?: string; roundConnectorId?: string }
  ): Promise<string | undefined>;
  reportCortex(
    scopeId: string,
    stepId: string,
    input: { conversationId?: string; roundId?: string; edits: AppliedCortexEdit[] }
  ): Promise<void>;
  reportMemory(
    scopeId: string,
    stepId: string,
    event: Omit<SemanticMemoryOptimizedEvent, 'workflow_execution_id'>
  ): Promise<void>;
}
export const OptimizerPolicyToken = createToken<OptimizerPolicyApi>('nightshift.optimizerPolicy');

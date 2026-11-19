/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type {
  NIGHTSHIFT_INVESTIGATION_AGENT_ID,
  NIGHTSHIFT_DECISION_TREE_REINFORCEMENT_AGENT_ID,
} from '../../common/agent_ids';

export type NightshiftAgentId =
  | typeof NIGHTSHIFT_INVESTIGATION_AGENT_ID
  | typeof NIGHTSHIFT_DECISION_TREE_REINFORCEMENT_AGENT_ID;
export interface AgentInstallationApi {
  ensure(scopeId: string, agentId: NightshiftAgentId): Promise<void>;
}
export const AgentInstallationToken = createToken<AgentInstallationApi>(
  'nightshift.agentInstallation'
);

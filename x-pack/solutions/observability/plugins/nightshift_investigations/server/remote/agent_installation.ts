/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import type { AgentAvailabilityConfig } from '@kbn/agent-builder-server/agents';
import type { ScopeLookup } from '@kbn/core-remote-server';
import { recordRemoteTiming, remotable } from '@kbn/core-remote-common';
import { NIGHTSHIFT_INVESTIGATION_AGENT_ID } from '../agents/investigation';
import { installInvestigationAgent } from '../lib/install_investigation_agent';
import { NIGHTSHIFT_DECISION_TREE_REINFORCEMENT_AGENT_ID } from '../agents/decision_tree_reinforcement';
import { installDecisionTreeReinforcementAgent } from '../lib/install_decision_tree_reinforcement_agent';

import type { AgentInstallationApi, NightshiftAgentId } from './agent_installation_tokens';
import { createInvestigationTransportError } from './investigation_errors';

/** Which agent a workflow wants installed. */
const AGENT_INSTALLERS = {
  [NIGHTSHIFT_INVESTIGATION_AGENT_ID]: installInvestigationAgent,
  [NIGHTSHIFT_DECISION_TREE_REINFORCEMENT_AGENT_ID]: installDecisionTreeReinforcementAgent,
} as const;

export const createAgentInstaller =
  ({
    getAgentBuilder,
    getAgentAvailability,
  }: {
    getAgentBuilder: () => AgentBuilderPluginStart | undefined;
    getAgentAvailability: () => AgentAvailabilityConfig;
  }) =>
  async (spaceId: string, agentId: NightshiftAgentId): Promise<void> => {
    const agentBuilder = getAgentBuilder();
    if (!agentBuilder)
      throw new Error('agentBuilder is not available, cannot install the investigation agent');
    if (!Object.hasOwn(AGENT_INSTALLERS, agentId)) throw new Error('Unknown Nightshift agent');
    await AGENT_INSTALLERS[agentId]({
      agentBuilder,
      spaceId,
      availability: getAgentAvailability(),
    });
  };

@remotable()
export class AgentInstallation implements AgentInstallationApi {
  constructor(
    private readonly scopes: ScopeLookup,
    private readonly install: ReturnType<typeof createAgentInstaller>
  ) {}
  async ensure(scopeId: string, agentId: NightshiftAgentId): Promise<void> {
    const started = performance.now();
    const cpu = process.cpuUsage();
    try {
      const signal = this.scopes.getAbortSignal(scopeId);
      signal.throwIfAborted();
      const { spaceId } = this.scopes.getRunState(scopeId);
      if (!Object.hasOwn(AGENT_INSTALLERS, agentId)) throw new Error('Unknown Nightshift agent');
      await this.install(spaceId, agentId);
      signal.throwIfAborted();
    } catch (error) {
      throw createInvestigationTransportError(error);
    } finally {
      const elapsed = process.cpuUsage(cpu);
      recordRemoteTiming('nightshift_agent_installation', {
        scopeId,
        durationMs: performance.now() - started,
        payloadBytes: Buffer.byteLength(JSON.stringify({ agentId })),
        cpuMicros: elapsed.user + elapsed.system,
      });
    }
  }
}

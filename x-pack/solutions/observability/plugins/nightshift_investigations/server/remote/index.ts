/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { RemoteModule } from '@kbn/core-remote-common';
import {
  ConversationRegistryToken,
  ConversationDataPlaneToken,
} from '@kbn/agent-builder-plugin/server/remote/conversation_tokens';
import { InvestigationDispatchToken } from './investigation_dispatch_tokens';
import { ReinforcementToken } from './reinforcement_tokens';
import { SandboxWorkspacesToken } from './sandbox_workspaces_tokens';
import { AgentInstallationToken } from './agent_installation_tokens';
import { InvestigationsToken } from './investigations_tokens';
import { DecisionTreePolicyToken } from './decision_tree_policy_tokens';
import { ModelSelectionToken } from './model_selection_tokens';

export const remoteModule: RemoteModule = {
  providers: [
    {
      token: InvestigationDispatchToken,
      placement: 'coordinator',
      modulePath: require.resolve('./investigation_dispatch'),
      exportName: 'InvestigationDispatch',
    },
    {
      token: ReinforcementToken,
      placement: 'coordinator',
      modulePath: require.resolve('./reinforcement'),
      exportName: 'Reinforcement',
    },
    {
      token: SandboxWorkspacesToken,
      placement: 'coordinator',
      modulePath: require.resolve('./sandbox_workspaces'),
      exportName: 'SandboxWorkspaces',
    },
    {
      token: AgentInstallationToken,
      placement: 'coordinator',
      modulePath: require.resolve('./agent_installation'),
      exportName: 'AgentInstallation',
    },
    {
      token: DecisionTreePolicyToken,
      placement: 'coordinator',
      modulePath: require.resolve('./decision_tree_policy'),
      exportName: 'DecisionTreePolicy',
    },
    {
      token: ModelSelectionToken,
      placement: 'coordinator',
      modulePath: require.resolve('./model_selection'),
      exportName: 'ModelSelection',
    },
    {
      token: InvestigationsToken,
      placement: 'coordinator',
      modulePath: require.resolve('./investigations'),
      exportName: 'Investigations',
    },
  ],
  contributions: [
    {
      kind: createToken('workflows.step'),
      stepType: 'nightshift.triggerInvestigation',
      needs: [InvestigationDispatchToken],
      modulePath: require.resolve('./trigger_investigation_step'),
      exportName: 'TriggerInvestigationStep',
    },
    {
      kind: createToken('workflows.step'),
      stepType: 'nightshift.decisionTreeReinforce',
      needs: [ReinforcementToken, ConversationRegistryToken, ConversationDataPlaneToken],
      modulePath: require.resolve('./decision_tree_reinforce_step'),
      exportName: 'DecisionTreeReinforceStep',
    },
    {
      kind: createToken('workflows.step'),
      stepType: 'nightshift.memoryMaterializeToSandbox',
      needs: [SandboxWorkspacesToken],
      modulePath: require.resolve('./memory_materialize_to_sandbox_step'),
      exportName: 'MemoryMaterializeToSandboxStep',
    },
    {
      kind: createToken('workflows.step'),
      stepType: 'nightshift.cortexHydrate',
      needs: [SandboxWorkspacesToken],
      modulePath: require.resolve('./cortex_hydrate_step'),
      exportName: 'CortexHydrateStep',
    },
    {
      kind: createToken('workflows.step'),
      stepType: 'nightshift.decisionTreeHydrate',
      needs: [SandboxWorkspacesToken, DecisionTreePolicyToken],
      modulePath: require.resolve('./decision_tree_hydrate_step'),
      exportName: 'DecisionTreeHydrateStep',
    },
    {
      kind: createToken('workflows.step'),
      stepType: 'nightshift.obtainSandbox',
      needs: [SandboxWorkspacesToken],
      modulePath: require.resolve('./obtain_sandbox_step'),
      exportName: 'ObtainSandboxStep',
    },
    {
      kind: createToken('workflows.step'),
      stepType: 'nightshift.renderSlackMessage',
      needs: [InvestigationsToken],
      modulePath: require.resolve('./render_slack_message_step'),
      exportName: 'RenderSlackMessageStep',
    },
    {
      kind: createToken('workflows.step'),
      stepType: 'nightshift.ensureInvestigationAgent',
      needs: [AgentInstallationToken],
      modulePath: require.resolve('./ensure_investigation_agent_step'),
      exportName: 'EnsureInvestigationAgentStep',
    },
    {
      kind: createToken('workflows.step'),
      stepType: 'nightshift.decisionTreePrepare',
      needs: [DecisionTreePolicyToken],
      modulePath: require.resolve('./decision_tree_prepare_step'),
      exportName: 'DecisionTreePrepareStep',
    },
    {
      kind: createToken('workflows.step'),
      stepType: 'nightshift.resolveModel',
      needs: [ModelSelectionToken],
      modulePath: require.resolve('./resolve_model_step'),
      exportName: 'ResolveModelStep',
    },
    {
      kind: createToken('workflows.step'),
      stepType: 'nightshift.followUpRecoveredAlert',
      needs: [InvestigationsToken],
      modulePath: require.resolve('./follow_up_recovered_alert_step'),
      exportName: 'FollowUpRecoveredAlertStep',
    },
    {
      kind: createToken('workflows.step'),
      stepType: 'nightshift.composeHydrateNotifications',
      modulePath: require.resolve('./compose_hydrate_notifications_step'),
      exportName: 'ComposeHydrateNotificationsStep',
    },
  ],
};

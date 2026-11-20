/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { hydrateMemoryWorkspaceWithSessionState as originalMemoryHydrate } from '../memory/register_memory';
import { hydrateMemoryWorkspaceWithSessionState } from '../memory/hydrate_workspace';
import { hydrateCortexWorkspaceWithTelemetry as originalCortexHydrate } from '../cortex/register_cortex';
import { hydrateCortexWorkspaceWithTelemetry } from '../cortex/hydrate_workspace';
import { hydrateDecisionTreeWorkspace as originalHydrate } from '../decision_trees/register_decision_trees';
import { hydrateDecisionTreeWorkspace } from '../decision_trees/hydrate_workspace';
import { prepareReinforcementTurn as originalPrepare } from '../decision_trees/register_decision_trees';
import { prepareReinforcementTurn } from '../decision_trees/prepare_reinforcement_turn';
import { withToolResults as originalJoin } from '../investigation_round/round_loader';
import { withToolResults } from '../investigation_round/with_tool_results';
import { notificationPhaseSchema as originalPhase } from '../lib/notifications/notification_routing';
import { notificationPhaseSchema } from '../lib/notifications/notification_phase';
import {
  MAX_KEYWORD_LENGTH as originalLimit,
  NIGHTSHIFT_INVESTIGATION_AGENT_ID as originalAgent,
  NIGHTSHIFT_ASSISTANT_AGENT_ID as originalAssistant,
} from '../../common';
import { MAX_KEYWORD_LENGTH } from '../../common/limits';
import {
  NIGHTSHIFT_INVESTIGATION_AGENT_ID,
  NIGHTSHIFT_ASSISTANT_AGENT_ID,
} from '../../common/agent_ids';
import { DECISION_TREE_LEARNING_TOOL_IDS as originalLearningTools } from '../tools/decision_tree';
import { DECISION_TREE_LEARNING_TOOL_IDS } from '../tools/decision_tree/learning_tools_ids';
import { toSlackThreadSubjectId as originalSlackSubject } from '../../common';
import { toSlackThreadSubjectId } from '../../common/investigation_subject';
import { DECISION_TREE_PROMPT_TOOLS } from '../tools/decision_tree/prompt_tools';
import { SANDBOX_VIEW_FILE_TOOL_ID } from '../tools/sandbox_bash/view_file_tool';
import { SANDBOX_STR_REPLACE_TOOL_ID } from '../tools/sandbox_bash/str_replace_tool';
import { SANDBOX_WRITE_FILE_TOOL_ID } from '../tools/sandbox_bash/write_file_tool';
import {
  RECORD_REMEDIATION_TOOL_ID,
  RECORD_SYSTEM_LEARNING_TOOL_ID,
  RECORD_TOOL_LEARNING_TOOL_ID,
} from '../tools/decision_tree/learning_tools';
import { DECISION_TREE_SUBMIT_TOOL_ID } from '../tools/decision_tree/submit_optimizer_result_tool';

it('preserves original helper/schema/constants exports and registered prompt tool identities', () => {
  expect(originalLearningTools).toBe(DECISION_TREE_LEARNING_TOOL_IDS);
  expect(originalSlackSubject).toBe(toSlackThreadSubjectId);
  expect(originalMemoryHydrate).toBe(hydrateMemoryWorkspaceWithSessionState);
  expect(originalCortexHydrate).toBe(hydrateCortexWorkspaceWithTelemetry);
  expect(originalHydrate).toBe(hydrateDecisionTreeWorkspace);
  expect(originalPrepare).toBe(prepareReinforcementTurn);
  expect(originalJoin).toBe(withToolResults);
  expect(originalPhase).toBe(notificationPhaseSchema);
  expect(originalLimit).toBe(MAX_KEYWORD_LENGTH);
  expect(originalAgent).toBe(NIGHTSHIFT_INVESTIGATION_AGENT_ID);
  expect(originalAssistant).toBe(NIGHTSHIFT_ASSISTANT_AGENT_ID);
  expect(DECISION_TREE_PROMPT_TOOLS).toEqual({
    viewFileTool: SANDBOX_VIEW_FILE_TOOL_ID,
    strReplaceTool: SANDBOX_STR_REPLACE_TOOL_ID,
    writeFileTool: SANDBOX_WRITE_FILE_TOOL_ID,
    submitTool: DECISION_TREE_SUBMIT_TOOL_ID,
    recordSystemTool: RECORD_SYSTEM_LEARNING_TOOL_ID,
    recordToolTool: RECORD_TOOL_LEARNING_TOOL_ID,
    recordRemediationTool: RECORD_REMEDIATION_TOOL_ID,
  });
});

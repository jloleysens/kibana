/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import { i18n } from '@kbn/i18n';
import type { ContextEnginePluginSetup } from '@kbn/context-engine-plugin/server';
import {
  DECISION_TREE_AI_INDEX_DEST,
  DECISION_TREE_AI_INDEX_ID,
} from '../../common/decision_trees';

/**
 * Registers the dedicated decision-tree AI index with the Context Engine so it is a managed,
 * discoverable index. The backing Elasticsearch index is auto-created from the `ai-index-idx`
 * template on first write, the same path Cortex uses.
 */
export const registerDecisionTreeAiIndex = (
  contextEngine: ContextEnginePluginSetup | undefined,
  logger: Logger
): void => {
  if (!contextEngine) {
    logger.debug('contextEngine is not available — decision-tree AI index will not be registered');
    return;
  }

  contextEngine.registerAiIndex(DECISION_TREE_AI_INDEX_ID, {
    description: i18n.translate('xpack.nightshiftInvestigations.decisionTrees.aiIndexDescription', {
      defaultMessage:
        'Nightshift decision trees — versioned Mermaid investigation trees and the learnings the reinforcement agent captures for each symptom.',
    }),
    dest: { type: 'index', value: DECISION_TREE_AI_INDEX_DEST },
    automations: [],
    sources: [],
    traces: [],
  });
};

export { hydrateDecisionTreeWorkspace } from './hydrate_workspace';

export { prepareReinforcementTurn } from './prepare_reinforcement_turn';

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RemoteModule } from '@kbn/core-remote-common';
import { AlertGraphEsToken, WorkflowStepKind, FingerprintPolicyToken } from './tokens';

export const remoteModule: RemoteModule = {
  providers: [
    {
      token: FingerprintPolicyToken,
      placement: 'coordinator',
      modulePath: require.resolve('./fingerprint_policy'),
      exportName: 'FingerprintPolicy',
    },
    {
      token: AlertGraphEsToken,
      placement: 'coordinator',
      modulePath: require.resolve('./alert_graph_es'),
      exportName: 'AlertGraphEs',
    },
  ],
  contributions: [
    {
      kind: WorkflowStepKind,
      stepType: 'security.getAlertEntities',
      modulePath: require.resolve(
        '../workflows/step_types/get_alert_entities_step/get_alert_entities_step_runtime'
      ),
      exportName: 'GetAlertEntitiesStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.buildExceptionEntriesFilter',
      modulePath: require.resolve(
        '../workflows/step_types/build_exception_entries_filter_step/build_exception_entries_filter_step_runtime'
      ),
      exportName: 'BuildExceptionEntriesFilterStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.matchAttackFingerprints',
      modulePath: require.resolve(
        '../workflows/step_types/match_attack_fingerprints/match_attack_fingerprints_step_runtime'
      ),
      exportName: 'MatchAttackFingerprintsStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.assignAlert',
      modulePath: require.resolve(
        '../workflows/step_types/assign_alert_step/assign_alert_step_runtime'
      ),
      exportName: 'AssignAlertStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.assignAttack',
      modulePath: require.resolve(
        '../workflows/step_types/assign_attack_step/assign_attack_step_runtime'
      ),
      exportName: 'AssignAttackStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.createExceptionListItem',
      modulePath: require.resolve(
        '../workflows/step_types/create_exception_list_item_step/create_exception_list_item_step_runtime'
      ),
      exportName: 'CreateExceptionListItemStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.createNote',
      modulePath: require.resolve(
        '../workflows/step_types/create_note_step/create_note_step_runtime'
      ),
      exportName: 'CreateNoteStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.createRuleException',
      modulePath: require.resolve(
        '../workflows/step_types/create_rule_exception_step/create_rule_exception_step_runtime'
      ),
      exportName: 'CreateRuleExceptionStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.createRule',
      modulePath: require.resolve(
        '../workflows/step_types/create_rule_step/create_rule_step_runtime'
      ),
      exportName: 'CreateRuleStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.deleteNote',
      modulePath: require.resolve(
        '../workflows/step_types/delete_note_step/delete_note_step_runtime'
      ),
      exportName: 'DeleteNoteStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.disableRule',
      modulePath: require.resolve(
        '../workflows/step_types/disable_rule_step/disable_rule_step_runtime'
      ),
      exportName: 'DisableRuleStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.enableRule',
      modulePath: require.resolve(
        '../workflows/step_types/enable_rule_step/enable_rule_step_runtime'
      ),
      exportName: 'EnableRuleStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.getNotes',
      modulePath: require.resolve('../workflows/step_types/get_notes_step/get_notes_step_runtime'),
      exportName: 'GetNotesStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.patchRule',
      modulePath: require.resolve(
        '../workflows/step_types/patch_rule_step/patch_rule_step_runtime'
      ),
      exportName: 'PatchRuleStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.renderAlertNarrative',
      modulePath: require.resolve(
        '../workflows/step_types/render_alert_narrative_step/render_alert_narrative_step_runtime'
      ),
      exportName: 'RenderAlertNarrativeStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.setAlertStatus',
      modulePath: require.resolve(
        '../workflows/step_types/set_alert_status_step/set_alert_status_step_runtime'
      ),
      exportName: 'SetAlertStatusStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.setAlertTags',
      modulePath: require.resolve(
        '../workflows/step_types/set_alert_tags_step/set_alert_tags_step_runtime'
      ),
      exportName: 'SetAlertTagsStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.setAttackStatus',
      modulePath: require.resolve(
        '../workflows/step_types/set_attack_status_step/set_attack_status_step_runtime'
      ),
      exportName: 'SetAttackStatusStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.setAttackTags',
      modulePath: require.resolve(
        '../workflows/step_types/set_attack_tags_step/set_attack_tags_step_runtime'
      ),
      exportName: 'SetAttackTagsStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.updateNote',
      modulePath: require.resolve(
        '../workflows/step_types/update_note_step/update_note_step_runtime'
      ),
      exportName: 'UpdateNoteStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'security.buildAlertEntityGraph',
      modulePath: require.resolve('./alert_graph_step'),
      exportName: 'AlertGraphStep',
    },
  ],
};

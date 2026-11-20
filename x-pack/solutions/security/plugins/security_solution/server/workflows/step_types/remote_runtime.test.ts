/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { assignAlertStepDefinition } from './assign_alert_step/assign_alert_step';
import {
  AssignAlertStep,
  handleAssignAlertStep,
} from './assign_alert_step/assign_alert_step_runtime';
import { assignAttackStepDefinition } from './assign_attack_step/assign_attack_step';
import {
  AssignAttackStep,
  handleAssignAttackStep,
} from './assign_attack_step/assign_attack_step_runtime';
import { createExceptionListItemStepDefinition } from './create_exception_list_item_step/create_exception_list_item_step';
import {
  CreateExceptionListItemStep,
  handleCreateExceptionListItemStep,
} from './create_exception_list_item_step/create_exception_list_item_step_runtime';
import { createNoteStepDefinition } from './create_note_step/create_note_step';
import { CreateNoteStep, handleCreateNoteStep } from './create_note_step/create_note_step_runtime';
import { createRuleExceptionStepDefinition } from './create_rule_exception_step/create_rule_exception_step';
import {
  CreateRuleExceptionStep,
  handleCreateRuleExceptionStep,
} from './create_rule_exception_step/create_rule_exception_step_runtime';
import { createRuleStepDefinition } from './create_rule_step/create_rule_step';
import { CreateRuleStep, handleCreateRuleStep } from './create_rule_step/create_rule_step_runtime';
import { deleteNoteStepDefinition } from './delete_note_step/delete_note_step';
import { DeleteNoteStep, handleDeleteNoteStep } from './delete_note_step/delete_note_step_runtime';
import { disableRuleStepDefinition } from './disable_rule_step/disable_rule_step';
import {
  DisableRuleStep,
  handleDisableRuleStep,
} from './disable_rule_step/disable_rule_step_runtime';
import { enableRuleStepDefinition } from './enable_rule_step/enable_rule_step';
import { EnableRuleStep, handleEnableRuleStep } from './enable_rule_step/enable_rule_step_runtime';
import { getNotesStepDefinition } from './get_notes_step/get_notes_step';
import { GetNotesStep, handleGetNotesStep } from './get_notes_step/get_notes_step_runtime';
import { patchRuleStepDefinition } from './patch_rule_step/patch_rule_step';
import { PatchRuleStep, handlePatchRuleStep } from './patch_rule_step/patch_rule_step_runtime';
import { renderAlertNarrativeStepDefinition } from './render_alert_narrative_step/render_alert_narrative_step';
import {
  RenderAlertNarrativeStep,
  handleRenderAlertNarrativeStep,
} from './render_alert_narrative_step/render_alert_narrative_step_runtime';
import { setAlertStatusStepDefinition } from './set_alert_status_step/set_alert_status_step';
import {
  SetAlertStatusStep,
  handleSetAlertStatusStep,
} from './set_alert_status_step/set_alert_status_step_runtime';
import { setAlertTagsStepDefinition } from './set_alert_tags_step/set_alert_tags_step';
import {
  SetAlertTagsStep,
  handleSetAlertTagsStep,
} from './set_alert_tags_step/set_alert_tags_step_runtime';
import { setAttackStatusStepDefinition } from './set_attack_status_step/set_attack_status_step';
import {
  SetAttackStatusStep,
  handleSetAttackStatusStep,
} from './set_attack_status_step/set_attack_status_step_runtime';
import { setAttackTagsStepDefinition } from './set_attack_tags_step/set_attack_tags_step';
import {
  SetAttackTagsStep,
  handleSetAttackTagsStep,
} from './set_attack_tags_step/set_attack_tags_step_runtime';
import { updateNoteStepDefinition } from './update_note_step/update_note_step';
import { UpdateNoteStep, handleUpdateNoteStep } from './update_note_step/update_note_step_runtime';

const cases = [
  {
    stepType: 'security.assignAlert',
    definition: assignAlertStepDefinition,
    Runtime: AssignAlertStep,
    handler: handleAssignAlertStep,
  },
  {
    stepType: 'security.assignAttack',
    definition: assignAttackStepDefinition,
    Runtime: AssignAttackStep,
    handler: handleAssignAttackStep,
  },
  {
    stepType: 'security.createExceptionListItem',
    definition: createExceptionListItemStepDefinition,
    Runtime: CreateExceptionListItemStep,
    handler: handleCreateExceptionListItemStep,
  },
  {
    stepType: 'security.createNote',
    definition: createNoteStepDefinition,
    Runtime: CreateNoteStep,
    handler: handleCreateNoteStep,
  },
  {
    stepType: 'security.createRuleException',
    definition: createRuleExceptionStepDefinition,
    Runtime: CreateRuleExceptionStep,
    handler: handleCreateRuleExceptionStep,
  },
  {
    stepType: 'security.createRule',
    definition: createRuleStepDefinition,
    Runtime: CreateRuleStep,
    handler: handleCreateRuleStep,
  },
  {
    stepType: 'security.deleteNote',
    definition: deleteNoteStepDefinition,
    Runtime: DeleteNoteStep,
    handler: handleDeleteNoteStep,
  },
  {
    stepType: 'security.disableRule',
    definition: disableRuleStepDefinition,
    Runtime: DisableRuleStep,
    handler: handleDisableRuleStep,
  },
  {
    stepType: 'security.enableRule',
    definition: enableRuleStepDefinition,
    Runtime: EnableRuleStep,
    handler: handleEnableRuleStep,
  },
  {
    stepType: 'security.getNotes',
    definition: getNotesStepDefinition,
    Runtime: GetNotesStep,
    handler: handleGetNotesStep,
  },
  {
    stepType: 'security.patchRule',
    definition: patchRuleStepDefinition,
    Runtime: PatchRuleStep,
    handler: handlePatchRuleStep,
  },
  {
    stepType: 'security.renderAlertNarrative',
    definition: renderAlertNarrativeStepDefinition,
    Runtime: RenderAlertNarrativeStep,
    handler: handleRenderAlertNarrativeStep,
  },
  {
    stepType: 'security.setAlertStatus',
    definition: setAlertStatusStepDefinition,
    Runtime: SetAlertStatusStep,
    handler: handleSetAlertStatusStep,
  },
  {
    stepType: 'security.setAlertTags',
    definition: setAlertTagsStepDefinition,
    Runtime: SetAlertTagsStep,
    handler: handleSetAlertTagsStep,
  },
  {
    stepType: 'security.setAttackStatus',
    definition: setAttackStatusStepDefinition,
    Runtime: SetAttackStatusStep,
    handler: handleSetAttackStatusStep,
  },
  {
    stepType: 'security.setAttackTags',
    definition: setAttackTagsStepDefinition,
    Runtime: SetAttackTagsStep,
    handler: handleSetAttackTagsStep,
  },
  {
    stepType: 'security.updateNote',
    definition: updateNoteStepDefinition,
    Runtime: UpdateNoteStep,
    handler: handleUpdateNoteStep,
  },
];

it.each(cases)(
  '$stepType shares exactly the original in-Kibana handler',
  ({ stepType, definition, handler }) => {
    expect(definition.id).toBe(stepType);
    expect(definition.handler).toBe(handler);
  }
);

it.each(cases)(
  '$stepType refuses missing worker-local context instead of calling a coordinator handler',
  async ({ Runtime }) => {
    await expect(new Runtime().run('scope', {}, {})).rejects.toThrow(
      'requires executor-local handler context'
    );
  }
);

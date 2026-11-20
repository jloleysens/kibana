/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RemoteModule } from '@kbn/core-remote-common';
import { WorkflowStepKind } from './tokens';
import { CasesClientOperationsToken } from './client_operations_tokens';

export const remoteModule: RemoteModule = {
  providers: [
    {
      token: CasesClientOperationsToken,
      placement: 'coordinator',
      modulePath: require.resolve('./client_operations'),
      exportName: 'CasesClientOperations',
    },
  ],
  contributions: [
    {
      kind: WorkflowStepKind,
      stepType: 'cases.addAttachments',
      modulePath: require.resolve('./add_attachments_step'),
      exportName: 'AddAttachmentsStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.getCase',
      modulePath: require.resolve('./get_case_step'),
      exportName: 'GetCaseStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.createCase',
      modulePath: require.resolve('./create_case_step'),
      exportName: 'CreateCaseStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.updateCase',
      modulePath: require.resolve('./update_case_step'),
      exportName: 'UpdateCaseStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.updateCases',
      modulePath: require.resolve('./update_cases_step'),
      exportName: 'UpdateCasesStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.addComment',
      modulePath: require.resolve('./add_comment_step'),
      exportName: 'AddCommentStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.findCases',
      modulePath: require.resolve('./find_cases_step'),
      exportName: 'FindCasesStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.setSeverity',
      modulePath: require.resolve('./set_severity_step'),
      exportName: 'SetSeverityStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.setStatus',
      modulePath: require.resolve('./set_status_step'),
      exportName: 'SetStatusStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.closeCase',
      modulePath: require.resolve('./close_case_step'),
      exportName: 'CloseCaseStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.deleteCases',
      modulePath: require.resolve('./delete_cases_step'),
      exportName: 'DeleteCasesStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.assignCase',
      modulePath: require.resolve('./assign_case_step'),
      exportName: 'AssignCaseStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.unassignCase',
      modulePath: require.resolve('./unassign_case_step'),
      exportName: 'UnassignCaseStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.addAlerts',
      modulePath: require.resolve('./add_alerts_step'),
      exportName: 'AddAlertsStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.addEvents',
      modulePath: require.resolve('./add_events_step'),
      exportName: 'AddEventsStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.findSimilarCases',
      modulePath: require.resolve('./find_similar_cases_step'),
      exportName: 'FindSimilarCasesStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.setDescription',
      modulePath: require.resolve('./set_description_step'),
      exportName: 'SetDescriptionStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.setTitle',
      modulePath: require.resolve('./set_title_step'),
      exportName: 'SetTitleStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.addObservables',
      modulePath: require.resolve('./add_observables_step'),
      exportName: 'AddObservablesStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.addTags',
      modulePath: require.resolve('./add_tags_step'),
      exportName: 'AddTagsStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.setCategory',
      modulePath: require.resolve('./set_category_step'),
      exportName: 'SetCategoryStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.getCasesByAlertId',
      modulePath: require.resolve('./get_cases_by_alert_id_step'),
      exportName: 'GetCasesByAlertIdStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.getAllAttachments',
      modulePath: require.resolve('./get_all_attachments_step'),
      exportName: 'GetAllAttachmentsStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.updateObservable',
      modulePath: require.resolve('./update_observable_step'),
      exportName: 'UpdateObservableStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.deleteObservable',
      modulePath: require.resolve('./delete_observable_step'),
      exportName: 'DeleteObservableStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.bulkDeleteObservables',
      modulePath: require.resolve('./bulk_delete_observables_step'),
      exportName: 'BulkDeleteObservablesStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.getCases',
      modulePath: require.resolve('./get_cases_step'),
      exportName: 'GetCasesStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.setCustomField',
      modulePath: require.resolve('./set_custom_field_step'),
      exportName: 'SetCustomFieldStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.removeTags',
      modulePath: require.resolve('./remove_tags_step'),
      exportName: 'RemoveTagsStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.pushCases',
      modulePath: require.resolve('./push_cases_step'),
      exportName: 'PushCasesStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.deleteAttachments',
      modulePath: require.resolve('./delete_attachments_step'),
      exportName: 'DeleteAttachmentsStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.createCaseFromTemplate',
      modulePath: require.resolve('./create_case_from_template_step'),
      exportName: 'CreateCaseFromTemplateStep',
    },
    {
      kind: WorkflowStepKind,
      stepType: 'cases.setExtendedFields',
      modulePath: require.resolve('./set_extended_fields_step'),
      exportName: 'SetExtendedFieldsStep',
    },
  ],
};

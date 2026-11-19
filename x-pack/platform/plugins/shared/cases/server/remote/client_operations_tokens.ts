/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { CasesClient } from '../client';

export interface CasesClientOperationsApi {
  assertConditionalStep(
    scopeId: string,
    stepType: 'cases.addAttachments' | 'cases.setExtendedFields'
  ): Promise<void>;
  templatesEnabled(scopeId: string): Promise<boolean>;
  caseGet(
    scopeId: string,
    args: Parameters<CasesClient['cases']['get']>
  ): ReturnType<CasesClient['cases']['get']>;
  caseCreate(
    scopeId: string,
    args: Parameters<CasesClient['cases']['create']>
  ): ReturnType<CasesClient['cases']['create']>;
  caseBulkGet(
    scopeId: string,
    args: Parameters<CasesClient['cases']['bulkGet']>
  ): ReturnType<CasesClient['cases']['bulkGet']>;
  caseBulkUpdate(
    scopeId: string,
    args: Parameters<CasesClient['cases']['bulkUpdate']>
  ): ReturnType<CasesClient['cases']['bulkUpdate']>;
  caseDelete(
    scopeId: string,
    args: Parameters<CasesClient['cases']['delete']>
  ): ReturnType<CasesClient['cases']['delete']>;
  caseFind(
    scopeId: string,
    args: Parameters<CasesClient['cases']['find']>
  ): ReturnType<CasesClient['cases']['find']>;
  caseSimilar(
    scopeId: string,
    args: Parameters<CasesClient['cases']['similar']>
  ): ReturnType<CasesClient['cases']['similar']>;
  caseGetCasesByAlertID(
    scopeId: string,
    args: Parameters<CasesClient['cases']['getCasesByAlertID']>
  ): ReturnType<CasesClient['cases']['getCasesByAlertID']>;
  caseBulkAddObservables(
    scopeId: string,
    args: Parameters<CasesClient['cases']['bulkAddObservables']>
  ): ReturnType<CasesClient['cases']['bulkAddObservables']>;
  caseBulkDeleteObservables(
    scopeId: string,
    args: Parameters<CasesClient['cases']['bulkDeleteObservables']>
  ): ReturnType<CasesClient['cases']['bulkDeleteObservables']>;
  caseDeleteObservable(
    scopeId: string,
    args: Parameters<CasesClient['cases']['deleteObservable']>
  ): ReturnType<CasesClient['cases']['deleteObservable']>;
  caseUpdateObservable(
    scopeId: string,
    args: Parameters<CasesClient['cases']['updateObservable']>
  ): ReturnType<CasesClient['cases']['updateObservable']>;
  caseReplaceCustomField(
    scopeId: string,
    args: Parameters<CasesClient['cases']['replaceCustomField']>
  ): ReturnType<CasesClient['cases']['replaceCustomField']>;
  casePush(
    scopeId: string,
    args: Parameters<CasesClient['cases']['push']>
  ): ReturnType<CasesClient['cases']['push']>;
  attachmentAdd(
    scopeId: string,
    args: Parameters<CasesClient['attachments']['add']>
  ): ReturnType<CasesClient['attachments']['add']>;
  attachmentBulkCreate(
    scopeId: string,
    args: Parameters<CasesClient['attachments']['bulkCreate']>
  ): ReturnType<CasesClient['attachments']['bulkCreate']>;
  attachmentBulkDelete(
    scopeId: string,
    args: Parameters<CasesClient['attachments']['bulkDelete']>
  ): ReturnType<CasesClient['attachments']['bulkDelete']>;
  attachmentGetAll(
    scopeId: string,
    args: Parameters<CasesClient['attachments']['getAll']>
  ): ReturnType<CasesClient['attachments']['getAll']>;
  configureGet(
    scopeId: string,
    args: Parameters<CasesClient['configure']['get']>
  ): ReturnType<CasesClient['configure']['get']>;
  configureGetConnectors(
    scopeId: string,
    args: Parameters<CasesClient['configure']['getConnectors']>
  ): ReturnType<CasesClient['configure']['getConnectors']>;
  templateGetTemplate(
    scopeId: string,
    args: Parameters<CasesClient['templates']['getTemplate']>
  ): ReturnType<CasesClient['templates']['getTemplate']>;
}
export const CasesClientOperationsToken =
  createToken<CasesClientOperationsApi>('cases.clientOperations');

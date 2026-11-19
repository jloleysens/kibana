/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { CasesClient } from '../client';
import type { ActionSource } from '../../common/types/domain';

export interface CasesClientOperationsApi {
  assertConditionalStep(
    scopeId: string,
    stepType: 'cases.addAttachments' | 'cases.setExtendedFields'
  ): Promise<void>;
  templatesEnabled(scopeId: string): Promise<boolean>;
  caseGet(
    scopeId: string,
    args: Parameters<CasesClient['cases']['get']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['cases']['get']>;
  caseCreate(
    scopeId: string,
    args: Parameters<CasesClient['cases']['create']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['cases']['create']>;
  caseBulkGet(
    scopeId: string,
    args: Parameters<CasesClient['cases']['bulkGet']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['cases']['bulkGet']>;
  caseBulkUpdate(
    scopeId: string,
    args: Parameters<CasesClient['cases']['bulkUpdate']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['cases']['bulkUpdate']>;
  caseDelete(
    scopeId: string,
    args: Parameters<CasesClient['cases']['delete']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['cases']['delete']>;
  caseFind(
    scopeId: string,
    args: Parameters<CasesClient['cases']['find']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['cases']['find']>;
  caseSimilar(
    scopeId: string,
    args: Parameters<CasesClient['cases']['similar']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['cases']['similar']>;
  caseGetCasesByAlertID(
    scopeId: string,
    args: Parameters<CasesClient['cases']['getCasesByAlertID']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['cases']['getCasesByAlertID']>;
  caseBulkAddObservables(
    scopeId: string,
    args: Parameters<CasesClient['cases']['bulkAddObservables']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['cases']['bulkAddObservables']>;
  caseBulkDeleteObservables(
    scopeId: string,
    args: Parameters<CasesClient['cases']['bulkDeleteObservables']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['cases']['bulkDeleteObservables']>;
  caseDeleteObservable(
    scopeId: string,
    args: Parameters<CasesClient['cases']['deleteObservable']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['cases']['deleteObservable']>;
  caseUpdateObservable(
    scopeId: string,
    args: Parameters<CasesClient['cases']['updateObservable']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['cases']['updateObservable']>;
  caseReplaceCustomField(
    scopeId: string,
    args: Parameters<CasesClient['cases']['replaceCustomField']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['cases']['replaceCustomField']>;
  casePush(
    scopeId: string,
    args: Parameters<CasesClient['cases']['push']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['cases']['push']>;
  attachmentAdd(
    scopeId: string,
    args: Parameters<CasesClient['attachments']['add']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['attachments']['add']>;
  attachmentBulkCreate(
    scopeId: string,
    args: Parameters<CasesClient['attachments']['bulkCreate']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['attachments']['bulkCreate']>;
  attachmentBulkDelete(
    scopeId: string,
    args: Parameters<CasesClient['attachments']['bulkDelete']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['attachments']['bulkDelete']>;
  attachmentGetAll(
    scopeId: string,
    args: Parameters<CasesClient['attachments']['getAll']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['attachments']['getAll']>;
  configureGet(
    scopeId: string,
    args: Parameters<CasesClient['configure']['get']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['configure']['get']>;
  configureGetConnectors(
    scopeId: string,
    args: Parameters<CasesClient['configure']['getConnectors']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['configure']['getConnectors']>;
  templateGetTemplate(
    scopeId: string,
    args: Parameters<CasesClient['templates']['getTemplate']>,
    actionSource?: ActionSource
  ): ReturnType<CasesClient['templates']['getTemplate']>;
}
export const CasesClientOperationsToken =
  createToken<CasesClientOperationsApi>('cases.clientOperations');

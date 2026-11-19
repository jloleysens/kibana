/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ActionSource } from '../../common/types/domain';
import type { WorkflowCasesClient } from '../workflows/types';
import type { CasesClientOperationsApi } from './client_operations_tokens';

const restoreCasesErrorName = async <T>(result: Promise<T>): Promise<T> => {
  try {
    return await result;
  } catch (error) {
    if (
      error instanceof Error &&
      'workflowCasesErrorName' in error &&
      typeof error.workflowCasesErrorName === 'string'
    ) {
      error.name = error.workflowCasesErrorName;
    }
    throw error;
  }
};

/** Exposes only the Cases methods used by original workflow handlers. */
export const createWorkflowCasesClient = (
  api: CasesClientOperationsApi,
  scopeId: string,
  actionSource?: ActionSource
): WorkflowCasesClient => ({
  cases: {
    get: (...args) => restoreCasesErrorName(api.caseGet(scopeId, args, actionSource)),
    create: (...args) => restoreCasesErrorName(api.caseCreate(scopeId, args, actionSource)),
    bulkGet: (...args) => restoreCasesErrorName(api.caseBulkGet(scopeId, args, actionSource)),
    bulkUpdate: (...args) => restoreCasesErrorName(api.caseBulkUpdate(scopeId, args, actionSource)),
    delete: (...args) => restoreCasesErrorName(api.caseDelete(scopeId, args, actionSource)),
    find: (...args) => restoreCasesErrorName(api.caseFind(scopeId, args, actionSource)),
    similar: (...args) => restoreCasesErrorName(api.caseSimilar(scopeId, args, actionSource)),
    getCasesByAlertID: (...args) =>
      restoreCasesErrorName(api.caseGetCasesByAlertID(scopeId, args, actionSource)),
    bulkAddObservables: (...args) =>
      restoreCasesErrorName(api.caseBulkAddObservables(scopeId, args, actionSource)),
    bulkDeleteObservables: (...args) =>
      restoreCasesErrorName(api.caseBulkDeleteObservables(scopeId, args, actionSource)),
    deleteObservable: (...args) =>
      restoreCasesErrorName(api.caseDeleteObservable(scopeId, args, actionSource)),
    updateObservable: (...args) =>
      restoreCasesErrorName(api.caseUpdateObservable(scopeId, args, actionSource)),
    replaceCustomField: (...args) =>
      restoreCasesErrorName(api.caseReplaceCustomField(scopeId, args, actionSource)),
    push: (...args) => restoreCasesErrorName(api.casePush(scopeId, args, actionSource)),
  },
  attachments: {
    add: (...args) => restoreCasesErrorName(api.attachmentAdd(scopeId, args, actionSource)),
    bulkCreate: (...args) =>
      restoreCasesErrorName(api.attachmentBulkCreate(scopeId, args, actionSource)),
    bulkDelete: (...args) =>
      restoreCasesErrorName(api.attachmentBulkDelete(scopeId, args, actionSource)),
    getAll: (...args) => restoreCasesErrorName(api.attachmentGetAll(scopeId, args, actionSource)),
  },
  configure: {
    get: (...args) => restoreCasesErrorName(api.configureGet(scopeId, args, actionSource)),
    getConnectors: (...args) =>
      restoreCasesErrorName(api.configureGetConnectors(scopeId, args, actionSource)),
  },
  templates: {
    getTemplate: (...args) =>
      restoreCasesErrorName(api.templateGetTemplate(scopeId, args, actionSource)),
  },
});

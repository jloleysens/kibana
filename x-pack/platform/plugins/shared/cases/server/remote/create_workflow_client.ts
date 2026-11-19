/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { WorkflowCasesClient } from '../workflows/types';
import type { CasesClientOperationsApi } from './client_operations_tokens';

/** Restores the original error projection after safe Cases capability transport. */
export const restoreCasesErrorName = async <T>(result: Promise<T>): Promise<T> => {
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
  scopeId: string
): WorkflowCasesClient => ({
  cases: {
    get: (...args) => restoreCasesErrorName(api.caseGet(scopeId, args)),
    create: (...args) => restoreCasesErrorName(api.caseCreate(scopeId, args)),
    bulkGet: (...args) => restoreCasesErrorName(api.caseBulkGet(scopeId, args)),
    bulkUpdate: (...args) => restoreCasesErrorName(api.caseBulkUpdate(scopeId, args)),
    delete: (...args) => restoreCasesErrorName(api.caseDelete(scopeId, args)),
    find: (...args) => restoreCasesErrorName(api.caseFind(scopeId, args)),
    similar: (...args) => restoreCasesErrorName(api.caseSimilar(scopeId, args)),
    getCasesByAlertID: (...args) => restoreCasesErrorName(api.caseGetCasesByAlertID(scopeId, args)),
    bulkAddObservables: (...args) =>
      restoreCasesErrorName(api.caseBulkAddObservables(scopeId, args)),
    bulkDeleteObservables: (...args) =>
      restoreCasesErrorName(api.caseBulkDeleteObservables(scopeId, args)),
    deleteObservable: (...args) => restoreCasesErrorName(api.caseDeleteObservable(scopeId, args)),
    updateObservable: (...args) => restoreCasesErrorName(api.caseUpdateObservable(scopeId, args)),
    replaceCustomField: (...args) =>
      restoreCasesErrorName(api.caseReplaceCustomField(scopeId, args)),
    push: (...args) => restoreCasesErrorName(api.casePush(scopeId, args)),
  },
  attachments: {
    add: (...args) => restoreCasesErrorName(api.attachmentAdd(scopeId, args)),
    bulkCreate: (...args) => restoreCasesErrorName(api.attachmentBulkCreate(scopeId, args)),
    bulkDelete: (...args) => restoreCasesErrorName(api.attachmentBulkDelete(scopeId, args)),
    getAll: (...args) => restoreCasesErrorName(api.attachmentGetAll(scopeId, args)),
  },
  configure: {
    get: (...args) => restoreCasesErrorName(api.configureGet(scopeId, args)),
    getConnectors: (...args) => restoreCasesErrorName(api.configureGetConnectors(scopeId, args)),
  },
  templates: {
    getTemplate: (...args) => restoreCasesErrorName(api.templateGetTemplate(scopeId, args)),
  },
});

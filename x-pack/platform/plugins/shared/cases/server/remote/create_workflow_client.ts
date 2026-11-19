/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ActionSource } from '../../common/types/domain';
import type { WorkflowCasesClient } from '../workflows/types';
import type { CasesClientOperationsApi } from './client_operations_tokens';

/** Exposes only the Cases methods used by original workflow handlers. */
export const createWorkflowCasesClient = (
  api: CasesClientOperationsApi,
  scopeId: string,
  actionSource?: ActionSource
): WorkflowCasesClient => ({
  cases: {
    get: (...args) => api.caseGet(scopeId, args, actionSource),
    create: (...args) => api.caseCreate(scopeId, args, actionSource),
    bulkGet: (...args) => api.caseBulkGet(scopeId, args, actionSource),
    bulkUpdate: (...args) => api.caseBulkUpdate(scopeId, args, actionSource),
    delete: (...args) => api.caseDelete(scopeId, args, actionSource),
    find: (...args) => api.caseFind(scopeId, args, actionSource),
    similar: (...args) => api.caseSimilar(scopeId, args, actionSource),
    getCasesByAlertID: (...args) => api.caseGetCasesByAlertID(scopeId, args, actionSource),
    bulkAddObservables: (...args) => api.caseBulkAddObservables(scopeId, args, actionSource),
    bulkDeleteObservables: (...args) => api.caseBulkDeleteObservables(scopeId, args, actionSource),
    deleteObservable: (...args) => api.caseDeleteObservable(scopeId, args, actionSource),
    updateObservable: (...args) => api.caseUpdateObservable(scopeId, args, actionSource),
    replaceCustomField: (...args) => api.caseReplaceCustomField(scopeId, args, actionSource),
    push: (...args) => api.casePush(scopeId, args, actionSource),
  },
  attachments: {
    add: (...args) => api.attachmentAdd(scopeId, args, actionSource),
    bulkCreate: (...args) => api.attachmentBulkCreate(scopeId, args, actionSource),
    bulkDelete: (...args) => api.attachmentBulkDelete(scopeId, args, actionSource),
    getAll: (...args) => api.attachmentGetAll(scopeId, args, actionSource),
  },
  configure: {
    get: (...args) => api.configureGet(scopeId, args, actionSource),
    getConnectors: (...args) => api.configureGetConnectors(scopeId, args, actionSource),
  },
  templates: {
    getTemplate: (...args) => api.templateGetTemplate(scopeId, args, actionSource),
  },
});

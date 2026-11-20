/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import type { CasesClient } from '../client';
import type { GetCasesClientOptions } from '../client/types';

export interface WorkflowCasesClient {
  readonly cases: Pick<
    CasesClient['cases'],
    | 'get'
    | 'create'
    | 'bulkGet'
    | 'bulkUpdate'
    | 'delete'
    | 'find'
    | 'similar'
    | 'getCasesByAlertID'
    | 'bulkAddObservables'
    | 'bulkDeleteObservables'
    | 'deleteObservable'
    | 'updateObservable'
    | 'replaceCustomField'
    | 'push'
  >;
  readonly attachments: Pick<
    CasesClient['attachments'],
    'add' | 'bulkCreate' | 'bulkDelete' | 'getAll'
  >;
  readonly configure: Pick<CasesClient['configure'], 'get' | 'getConnectors'>;
  readonly templates: Pick<CasesClient['templates'], 'getTemplate'>;
}
export type GetWorkflowCasesClient = (
  request: KibanaRequest,
  options?: GetCasesClientOptions
) => Promise<WorkflowCasesClient>;

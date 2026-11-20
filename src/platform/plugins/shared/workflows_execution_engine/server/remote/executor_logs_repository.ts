/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { BulkOperationContainer } from '@elastic/elasticsearch/lib/api/types';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import { noopLogger } from './noop_logger';
import { WORKFLOWS_EXECUTION_LOGS_DATA_STREAM } from '../repositories/logs_repository/constants';
import { createLogs } from '../repositories/logs_repository/create_logs';
import type {
  LogsRepositoryDataStreamClient,
  WorkflowLogEvent,
} from '../repositories/logs_repository/data_stream';
import type { LogsRepository } from '../repositories/logs_repository/logs_repository';

/** Matches DataStreamClient.create for the space-agnostic path used by the logs repository. */
export const createExecutorLogClient = (
  client: ElasticsearchClient
): Pick<LogsRepositoryDataStreamClient, 'create'> => ({
  async create({ space, documents, ...options }) {
    if (space !== undefined) {
      throw new Error('Workflow log persistence does not use data-stream Space decoration');
    }
    const operations: Array<BulkOperationContainer | WorkflowLogEvent> = [];
    for (const { _id, ...document } of documents) {
      if (_id !== undefined && _id.includes('::')) {
        throw new Error(
          "Invalid document ID: IDs cannot contain '::'. This separator is reserved for system use."
        );
      }
      operations.push({ create: _id ? { _id } : {} }, document);
    }
    return client.bulk({ index: WORKFLOWS_EXECUTION_LOGS_DATA_STREAM, ...options, operations });
  },
});

/** Lifecycle stays coordinator-owned; both placements share the original repository write body. */
export const createExecutorLogsRepository = (
  client: ElasticsearchClient
): Pick<LogsRepository, 'createLogs'> => {
  const dataStreamClient = createExecutorLogClient(client);
  const logger = noopLogger();
  return { createLogs: (events) => createLogs(async () => dataStreamClient, logger, events) };
};

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { Logger } from '@kbn/logging';
import type { LogsRepositoryDataStreamClient, WorkflowLogEvent } from './data_stream';
import { retryTransientEsErrors } from '../../lib/retry_transient_es_errors';

/** Persists original workflow log documents with the repository's bounded transient retry. */
export const createLogs = async (
  getClient: () => Promise<Pick<LogsRepositoryDataStreamClient, 'create'>>,
  logger: Logger,
  logEvents: WorkflowLogEvent[]
): Promise<void> => {
  const dataStreamClient = await getClient();

  await retryTransientEsErrors(() => dataStreamClient.create({ documents: logEvents }), {
    logger,
  });
};

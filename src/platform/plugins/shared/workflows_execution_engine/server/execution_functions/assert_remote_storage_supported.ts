/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { WorkflowsExecutionEngineConfig } from '../config';

/** Refuses unsupported remote persistence before any execution can cross its start barrier. */
export const assertRemoteStorageSupported = (
  config: WorkflowsExecutionEngineConfig,
  executeRemote: boolean
): void => {
  if (executeRemote && config.storage.source !== 'plain_index') {
    throw new Error(
      'Remote workflow execution does not support data_stream storage; disable workflowsExecutionEngine.remoteExecution.enabled to use the local engine. Execution has not been started by this dispatch.'
    );
  }
};

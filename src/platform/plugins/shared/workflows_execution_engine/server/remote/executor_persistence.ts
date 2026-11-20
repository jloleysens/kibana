/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { EsWorkflowExecution, EsWorkflowStepExecution } from '@kbn/workflows';
import { noopLogger } from './noop_logger';
import type { WorkflowControlApi, WorkflowStorageApi } from './tokens';
import { WorkflowStorage } from './workflow_storage';
import {
  WORKFLOWS_EXECUTIONS_INDEX,
  WORKFLOWS_STEP_EXECUTIONS_INDEX,
} from '../repositories/data_access_layer/constants/execution_indexes';
import { PlainIndexDataClient } from '../repositories/data_access_layer/implementations/plain_index/plain_index_data_client';
import { StepExecutionRepository } from '../repositories/step_execution_repository';
import { WorkflowExecutionRepository } from '../repositories/workflow_execution_repository';

/** Reuses the existing repository semantics without booting their plugin or initializing indices. */
export const createExecutorPersistence = (
  esClient: ElasticsearchClient,
  control: WorkflowControlApi
): WorkflowStorageApi => {
  const logger = noopLogger();
  return new WorkflowStorage(
    new WorkflowExecutionRepository(
      new PlainIndexDataClient<EsWorkflowExecution>({
        esClient,
        logger,
        indexName: WORKFLOWS_EXECUTIONS_INDEX,
      })
    ),
    new StepExecutionRepository(
      new PlainIndexDataClient<EsWorkflowStepExecution>({
        esClient,
        logger,
        indexName: WORKFLOWS_STEP_EXECUTIONS_INDEX,
      })
    ),
    logger,
    control
  );
};

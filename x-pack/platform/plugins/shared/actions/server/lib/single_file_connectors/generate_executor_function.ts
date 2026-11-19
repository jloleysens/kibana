/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { clientTypes as defaultClientTypes } from '@kbn/connector-specs/server';
import { createTaskRunError, TaskErrorSource } from '@kbn/task-manager-plugin/server';
import { getErrorSource, isUserError } from '@kbn/task-manager-plugin/server/task_running';
import { createSpecExecutor } from './create_spec_executor';

type SpecExecutorOptions = Parameters<typeof createSpecExecutor>[0];

export const generateExecutorFunction = ({
  clientTypes = defaultClientTypes,
  ...options
}: Omit<SpecExecutorOptions, 'errors' | 'clientTypes'> & {
  clientTypes?: SpecExecutorOptions['clientTypes'];
}) =>
  createSpecExecutor({
    ...options,
    clientTypes,
    errors: { createTaskRunError, TaskErrorSource, getErrorSource, isUserError },
  });

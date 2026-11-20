/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server/step_registry/types';
import type { ServiceManager } from '../services';
import { runAgentStepCommonDefinition } from '../../common/step_types/run_agent_step';
import { createRunAgentStepHandler } from '../remote/run_agent_step_handler';
import { createWorkflowAgentRunner } from './workflow_agent_runner';

export { parseMaxStepSize } from './workflow_agent_runner';

/** Defines the original in-Kibana agent step using the same normalization as the remote step. */
export const getRunAgentStepDefinition = (serviceManager: ServiceManager) =>
  createServerStepDefinition({
    ...runAgentStepCommonDefinition,
    handler: createRunAgentStepHandler(createWorkflowAgentRunner(serviceManager)),
  });

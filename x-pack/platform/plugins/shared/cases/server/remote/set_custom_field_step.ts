/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import { setCustomFieldStepDefinition } from '../workflows/steps/set_custom_field';
import {
  CasesClientOperationsToken,
  type CasesClientOperationsApi,
} from './client_operations_tokens';
import { runCasesStep } from './run_cases_step';

export class SetCustomFieldStep implements RemoteWorkflowStep {
  constructor(@inject(CasesClientOperationsToken) private readonly api: CasesClientOperationsApi) {}
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    return runCasesStep(this.api, setCustomFieldStepDefinition, ...args);
  }
}

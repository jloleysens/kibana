/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { inject } from 'inversify';
import type { RemoteWorkflowStep } from '@kbn/workflows-extensions/server';
import {
  WorkflowStepCatalogToken,
  type WorkflowStepCatalogApi,
} from '@kbn/workflows-extensions/server/remote/tokens';
import { SpecRuntimeToken } from '@kbn/actions-plugin/server/remote/tokens';
import type { SpecRuntime } from '@kbn/actions-plugin/server/remote/spec_runtime';
import {
  NotificationAuthorityToken,
  type NotificationAuthorityApi,
} from './notification_authority_tokens';
import { runNotificationStep } from './notification_step';
export class HandleInvestigationFailureStep implements RemoteWorkflowStep {
  constructor(
    @inject(NotificationAuthorityToken) private readonly authority: NotificationAuthorityApi,
    @inject(SpecRuntimeToken) private readonly runtime: SpecRuntime,
    @inject(WorkflowStepCatalogToken) private readonly catalog: WorkflowStepCatalogApi
  ) {}
  async run(...args: Parameters<RemoteWorkflowStep['run']>): ReturnType<RemoteWorkflowStep['run']> {
    return runNotificationStep(true, this.authority, this.runtime, this.catalog, args);
  }
}

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { LogLevelId, LogMeta } from '@kbn/logging';
import type { DefaultValidationContext } from '../workflows/steps/default_validation_step/default_validation_handler';
export interface ValidationDiagnostic {
  level: LogLevelId;
  message: string;
  context: string[];
  meta?: LogMeta;
}
export interface AttackDiscoveryOperationsApi {
  getRetrievalSpace(scopeId: string): Promise<string>;
  openRetrieval(scopeId: string): Promise<string>;
  resolveRetrievalConnector(
    scopeId: string,
    reference: string,
    connectorId: string
  ): Promise<{ connectorName: string }>;
  closeRetrieval(scopeId: string, reference: string): Promise<void>;
  checkEnabled(scopeId: string): Promise<Record<LogLevelId, boolean>>;
  prepareValidation(
    scopeId: string,
    input: Pick<DefaultValidationContext['input'], 'api_config' | 'connector_name'>
  ): Promise<{ spaceId: string; resolvedConnectorName: string }>;
  validationDiagnostics(scopeId: string, records: ValidationDiagnostic[]): Promise<void>;
}
export const AttackDiscoveryOperationsToken = createToken<AttackDiscoveryOperationsApi>(
  'attackDiscovery.operations'
);
export const WorkflowStepKind = createToken('workflows.step');

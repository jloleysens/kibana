/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createToken } from '@kbn/core-di';
import type { CreateAlertEventData } from '@kbn/alerting-v2-schemas';
import type { AlertEpisodeRow } from '../lib/alert_events_client/alert_event_algorithms';
import type { AlertEventDocument } from '../resources/datastreams/alert_events';
export interface AlertEventStorageApi {
  canWrite(scopeId: string): Promise<boolean>;
  parse(scopeId: string, input: unknown): Promise<CreateAlertEventData>;
  open(scopeId: string): Promise<{ reference: string; spaceId: string }>;
  readLatest(
    scopeId: string,
    reference: string,
    event: CreateAlertEventData
  ): Promise<AlertEpisodeRow[]>;
  persist(scopeId: string, reference: string, doc: AlertEventDocument): Promise<void>;
  close(scopeId: string, reference: string): Promise<void>;
}
export const AlertEventStorageToken = createToken<AlertEventStorageApi>(
  'alertingV2.alertEventStorage'
);
export const WorkflowStepKind = createToken('workflows.step');

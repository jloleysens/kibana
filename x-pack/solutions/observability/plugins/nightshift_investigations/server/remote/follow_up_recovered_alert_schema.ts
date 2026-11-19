/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { lazySchema, z } from '@kbn/zod/v4';

const MAX_ALERT_FIELD_LENGTH = 500;

export const inputSchema = lazySchema(() =>
  z.object({
    alert_uuid: z.string().min(1).max(MAX_ALERT_FIELD_LENGTH).describe('The recovered alert UUID'),
    alert_id: z.string().min(1).max(MAX_ALERT_FIELD_LENGTH).describe('The alert instance ID'),
    alert_start: z
      .string()
      .max(100)
      .nullable()
      .optional()
      .describe('When the alert first became active'),
    recovered_at: z
      .string()
      .max(100)
      .optional()
      .describe('When the recovery event was dispatched to workflows'),
    rule_id: z.string().min(1).max(MAX_ALERT_FIELD_LENGTH),
    rule_name: z.string().min(1).max(MAX_ALERT_FIELD_LENGTH),
    rule_type_id: z.string().min(1).max(MAX_ALERT_FIELD_LENGTH),
    rule_tags: z.array(z.string().max(MAX_ALERT_FIELD_LENGTH)).max(50).optional(),
  })
);

export const outputSchema = lazySchema(() =>
  z.object({
    investigation_id: z
      .string()
      .optional()
      .describe('The investigation the recovery round was requested on'),
    execution_id: z
      .string()
      .optional()
      .describe(
        'The investigation workflow execution of the recovery round, which records whether it ran'
      ),
    skip_reason: z
      .literal('no_open_investigation')
      .optional()
      .describe('Why no recovery round was queued'),
  })
);

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { lazySchema, z } from '@kbn/zod/v4';
import type { JsonValue } from '@kbn/utility-types';
/** Bound on notification destinations one investigation fans out to; one per automation is the norm. */
export const MAX_INVESTIGATION_NOTIFICATIONS = 5;

const MAX_NOTIFICATION_PARAM_LENGTH = 4096;
const MAX_NOTIFICATION_PARAM_ENTRIES = 20;
const MAX_NOTIFICATION_PARAM_DEPTH = 3;

// A finite schema rejects deeply nested or cyclic input without unbounded recursion.
const notificationParamValueSchema = (remainingDepth: number): z.ZodType<JsonValue> => {
  const scalar = z.union([
    z.string().max(MAX_NOTIFICATION_PARAM_LENGTH),
    z.number(),
    z.boolean(),
    z.null(),
  ]);
  if (remainingDepth === 0) {
    return scalar;
  }
  const child = notificationParamValueSchema(remainingDepth - 1);
  return z.union([
    scalar,
    z.array(child).max(MAX_NOTIFICATION_PARAM_ENTRIES),
    z
      .record(z.string().max(128), child)
      .refine((value) => Object.keys(value).length <= MAX_NOTIFICATION_PARAM_ENTRIES, {
        message: 'notification params exceed the 20-key limit',
      }),
  ]);
};

/** Generic destination envelope; notification handlers validate connector-specific params at runtime. */
export const investigationNotificationDestinationSchema = lazySchema(() =>
  z.strictObject({
    type: z.string().min(1).max(100),
    connector_id: z.string().min(1).max(500),
    params: z
      .record(z.string().max(128), notificationParamValueSchema(MAX_NOTIFICATION_PARAM_DEPTH - 1))
      .refine((value) => Object.keys(value).length <= MAX_NOTIFICATION_PARAM_ENTRIES, {
        message: 'notification params exceed the 20-key limit',
      })
      .refine((value) => JSON.stringify(value).length <= MAX_NOTIFICATION_PARAM_LENGTH, {
        message: 'notification params exceed the 4096-character JSON limit',
      }),
    automation_id: z.string().max(500).optional(),
    automation_name: z.string().max(500).optional(),
  })
);

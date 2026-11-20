/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { lazySchema, z } from '@kbn/zod/v4';
import { MAX_TEXT_LENGTH } from '@kbn/significant-events-runtime';
import { MAX_KEYWORD_LENGTH } from '../../common/limits';

export const inputSchema = lazySchema(() =>
  z.object({
    investigation_id: z.string().min(1).max(MAX_KEYWORD_LENGTH),
    reason: z.string().max(MAX_TEXT_LENGTH),
  })
);

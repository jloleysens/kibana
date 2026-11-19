/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ByteSizeValue } from '@kbn/config-schema';
import { DEFAULT_MAX_STEP_SIZE, parseByteSize } from './errors';

/** Shares local output-size precedence with coordinator-owned step policies. */
export const resolveStepOutputLimit = (
  getStepLimit: () => string | undefined,
  getWorkflowLimit: () => string | undefined,
  getPluginLimit: () => number | ByteSizeValue | undefined
): number => {
  try {
    const stepLimit = getStepLimit();
    if (stepLimit) return parseByteSize(stepLimit);
    const workflowLimit = getWorkflowLimit();
    if (workflowLimit) return parseByteSize(workflowLimit);
    const pluginLimit = getPluginLimit();
    if (pluginLimit !== undefined)
      return typeof pluginLimit === 'number' ? pluginLimit : pluginLimit.getValueInBytes();
    return parseByteSize(DEFAULT_MAX_STEP_SIZE);
  } catch {
    return parseByteSize(DEFAULT_MAX_STEP_SIZE);
  }
};

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ByteSizeValue } from '@kbn/config-schema';

/**
 * Parses a `max-step-size` value (e.g. `"10mb"` or a raw byte count) into bytes, the same way the
 * ai.agent step does. Returns `undefined` for empty or malformed values so the limit is not changed.
 */
export const parseMaxStepSize = (value: string | undefined): number | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return ByteSizeValue.parse(trimmed).getValueInBytes();
  } catch {
    return undefined;
  }
};
